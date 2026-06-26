// /api/notion.js
// Vercel serverless function. Receives a Notion integration token + a
// Notion page/database URL, queries the database, and returns a flat list
// of items the frontend grid can render.

function extractDatabaseId(pageUrl) {
  const match =
    pageUrl.match(/([a-f0-9]{32})(?:[^a-f0-9]|$)/i) ||
    pageUrl.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
  if (!match) return null;
  return match[1].replace(/-/g, "");
}

function formatDashedId(id) {
  return `${id.slice(0,8)}-${id.slice(8,12)}-${id.slice(12,16)}-${id.slice(16,20)}-${id.slice(20)}`;
}

function isImageUrl(url) {
  return /\.(jpg|jpeg|png|gif|webp|avif)(\?|$)/i.test(url || "");
}

function isVideoUrl(url) {
  return /\.(mp4|mov|webm)(\?|$)/i.test(url || "");
}

function findProp(props, ...names) {
  for (const name of names) {
    if (props[name]) return props[name];
    const key = Object.keys(props).find(k => k.toLowerCase() === name.toLowerCase());
    if (key) return props[key];
  }
  return null;
}

function firstOfType(props, type) {
  const key = Object.keys(props).find(k => props[k]?.type === type);
  return key ? props[key] : null;
}

function getText(prop) {
  if (!prop) return "";
  if (prop.type === "title")        return prop.title?.map(t => t.plain_text).join("") || "";
  if (prop.type === "rich_text")    return prop.rich_text?.map(t => t.plain_text).join("") || "";
  if (prop.type === "url")          return prop.url || "";
  if (prop.type === "select")       return prop.select?.name || "";
  if (prop.type === "status")       return prop.status?.name || "";
  if (prop.type === "multi_select") return prop.multi_select?.map(s => s.name).join(", ") || "";
  if (prop.type === "email")        return prop.email || "";
  if (prop.type === "phone_number") return prop.phone_number || "";
  return "";
}

function getNumber(prop) {
  if (!prop) return 0;
  if (prop.type === "number") return prop.number || 0;
  if (prop.type === "formula" && prop.formula?.type === "number") return prop.formula.number || 0;
  return 0;
}

function getDate(prop) {
  if (!prop) return "";
  if (prop.type === "date")             return prop.date?.start || "";
  if (prop.type === "created_time")     return (prop.created_time || "").split("T")[0];
  if (prop.type === "last_edited_time") return (prop.last_edited_time || "").split("T")[0];
  return "";
}

function getCheckbox(prop) {
  return prop?.type === "checkbox" ? !!prop.checkbox : false;
}

function getAllFileUrls(prop) {
  if (!prop || !prop.files?.length) return [];
  return prop.files.map(f =>
    f.type === "external" ? f.external?.url || "" : f.file?.url || ""
  ).filter(Boolean);
}

function mapPage(page) {
  const props = page.properties || {};

  // Title
  const titleProp = findProp(props, "Name", "Title", "Post", "Caption", "Content", "Pamagat")
    || firstOfType(props, "title");
  const title = getText(titleProp) || "Untitled";

  // Image
  let image = "";
  let isCarousel = false;
  let isVideo = false;

  // 1. Page cover
  if (page.cover) {
    image = page.cover.type === "external"
      ? page.cover.external?.url || ""
      : page.cover.file?.url || "";
  }

  // 2. Files/media property
  if (!image) {
    const fileProp = findProp(props, "Image", "Cover", "Photo", "Media", "Thumbnail", "Picture", "Larawan", "Foto")
      || firstOfType(props, "files");
    if (fileProp) {
      const urls = getAllFileUrls(fileProp);
      if (urls.length) {
        image = urls[0];
        isCarousel = urls.length > 1;
        isVideo = isVideoUrl(image);
      }
    }
  }

  // 3. URL property that looks like an image
  if (!image) {
    for (const key of Object.keys(props)) {
      const p = props[key];
      if (p.type === "url" && p.url && (isImageUrl(p.url) || isVideoUrl(p.url))) {
        image = p.url;
        isVideo = isVideoUrl(p.url);
        break;
      }
    }
  }

  // Type override
  const typeProp = findProp(props, "Type", "Format", "Post Type", "Content Type");
  const typeVal = getText(typeProp).toLowerCase();
  if (typeVal.includes("reel") || typeVal.includes("video"))     isVideo = true;
  if (typeVal.includes("carousel") || typeVal.includes("album")) isCarousel = true;

  // Date
  const dateProp = findProp(props, "Date", "Published", "Scheduled", "Petsa", "Post Date", "Publish Date")
    || firstOfType(props, "date")
    || firstOfType(props, "created_time");
  const date = getDate(dateProp) || (page.created_time || "").split("T")[0];

  // Category
  const catProp = findProp(props, "Category", "Tag", "Tags", "Niche", "Topic", "Label", "Kategorya")
    || firstOfType(props, "select")
    || firstOfType(props, "multi_select");
  const category = getText(catProp) || null;

  // Engagement
  const likes    = getNumber(findProp(props, "Likes", "Hearts", "Like", "Reactions"));
  const comments = getNumber(findProp(props, "Comments", "Comment", "Replies"));

  // Post URL
  const url = getText(findProp(props, "URL", "Link", "Url", "Post URL", "IG Link", "Instagram")) || "";

  // Tagged
  const tagged = getCheckbox(findProp(props, "Tagged", "Collab", "Tag Me"));

  return { id: page.id, title, image, date, category, isVideo, isCarousel, likes, comments, url, tagged };
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  try {
    const { token, pageUrl } = req.body || {};

    if (!token || !pageUrl) {
      return res.status(400).json({ success: false, error: "Missing token or page URL." });
    }

    const rawId = extractDatabaseId(pageUrl);
    if (!rawId) {
      return res.status(400).json({
        success: false,
        error: "Could not find a valid database ID in that URL. Paste the full Notion database URL.",
      });
    }

    const databaseId = formatDashedId(rawId);

    const notionRes = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ page_size: 100 }),
    });

    const data = await notionRes.json();

    if (!notionRes.ok) {
      return res.status(notionRes.status).json({
        success: false,
        error: data?.message || data?.code || "Notion API error",
      });
    }

    const items = (data.results || []).map(mapPage);

    return res.status(200).json({ success: true, items });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, error: err.message || "Unexpected server error." });
  }
};
