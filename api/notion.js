// /api/notion.js
// Vercel serverless function. Receives a Notion integration token + a
// Notion page/database URL, queries the database, and returns a flat list
// of items the frontend grid can render.

function extractDatabaseId(pageUrl) {
  // Notion URLs end with a 32-char id (with or without dashes), optionally
  // followed by ?v=... Match the last 32 hex chars in the URL.
  const match = pageUrl.match(/([a-f0-9]{32})(?:[^a-f0-9]|$)/i) ||
                pageUrl.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
  if (!match) return null;
  return match[1].replace(/-/g, "");
}

function formatDashedId(id) {
  return `${id.slice(0,8)}-${id.slice(8,12)}-${id.slice(12,16)}-${id.slice(16,20)}-${id.slice(20)}`;
}

function getFirstOfType(properties, type) {
  for (const key in properties) {
    if (properties[key]?.type === type) return properties[key];
  }
  return null;
}

function isImageUrl(url) {
  return /\.(jpg|jpeg|png|gif|webp|avif)(\?|$)/i.test(url || "");
}

function isVideoUrl(url) {
  return /\.(mp4|mov|webm)(\?|$)/i.test(url || "");
}

function mapPage(page) {
  const props = page.properties;

  const titleProp = getFirstOfType(props, "title");
  const title = titleProp?.title?.[0]?.plain_text || "Untitled";

  const dateProp = getFirstOfType(props, "date");
  const date = dateProp?.date?.start || null;

  const selectProp = getFirstOfType(props, "select");
  const category = selectProp?.select?.name || null;

  // Look for an image: prefer a Files property, then any URL property that
  // looks like an image/video link.
  const filesProp = getFirstOfType(props, "files");
  let image = null;
  let isVideo = false;
  let isCarousel = false;

  if (filesProp?.files?.length > 0) {
    const urls = filesProp.files
      .map((f) => f.file?.url || f.external?.url)
      .filter(Boolean);
    if (urls.length > 0) {
      image = urls[0];
      isCarousel = urls.length > 1;
      isVideo = isVideoUrl(image);
    }
  }

  if (!image) {
    for (const key in props) {
      const p = props[key];
      if (p.type === "url" && p.url) {
        if (isImageUrl(p.url) || isVideoUrl(p.url)) {
          image = p.url;
          isVideo = isVideoUrl(p.url);
          break;
        }
        // Fall back to any url at all (e.g. Canva links) if nothing image-like found.
        if (!image) image = p.url;
      }
    }
  }

  return { title, image, date, category, isVideo, isCarousel };
}

async function resolveDataSourceId(databaseId, token) {
  // Notion's 2025-09-03+ API requires querying a "data source" rather than
  // the database directly. Retrieve the database first to get its data
  // source id, then query that.
  const dbRes = await fetch(`https://api.notion.com/v1/databases/${databaseId}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": "2025-09-03",
    },
  });
  const dbData = await dbRes.json();
  if (!dbRes.ok) {
    return { error: dbData?.message || "Could not retrieve database." };
  }
  const dataSourceId = dbData?.data_sources?.[0]?.id;
  if (!dataSourceId) {
    return { error: "This database has no accessible data sources for this integration." };
  }
  return { dataSourceId };
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ success: false, error: "Method not allowed" });
    return;
  }

  try {
    const { token, pageUrl } = req.body || {};

    if (!token || !pageUrl) {
      res.status(400).json({ success: false, error: "Missing token or page URL." });
      return;
    }

    const rawId = extractDatabaseId(pageUrl);
    if (!rawId) {
      res.status(400).json({ success: false, error: "Could not find a valid database ID in that URL." });
      return;
    }
    const databaseId = formatDashedId(rawId);

    // Try the new data-source-based flow first (required as of Notion API 2025-09-03).
    let notionRes, data;
    const resolved = await resolveDataSourceId(databaseId, token);

    if (resolved.dataSourceId) {
      notionRes = await fetch(`https://api.notion.com/v1/data_sources/${resolved.dataSourceId}/query`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Notion-Version": "2025-09-03",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ page_size: 60 }),
      });
      data = await notionRes.json();
    } else {
      // Fall back to the legacy database query endpoint (older single-source databases).
      notionRes = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Notion-Version": "2022-06-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ page_size: 60 }),
      });
      data = await notionRes.json();
    }

    if (!notionRes.ok) {
      res.status(notionRes.status).json({
        success: false,
        error: data?.message || resolved.error || "Notion API rejected the request. Check your token and that the integration is connected to this database.",
      });
      return;
    }

    const items = (data.results || []).map(mapPage);

    res.status(200).json({ success: true, items });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message || "Unexpected server error." });
  }
}
