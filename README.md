# IG Grid Preview Widget for Notion

Next.js app na nagdidisplay ng Instagram-style feed grid, na-source mula sa Notion database — base sa "Instagram Grid Widget + Calendar" structure.

## 1. Notion Database (gamitin ang EXISTING database mo, dapat may ganito):

| Property name     | Type        | Notes                                              |
|--------------------|-------------|-----------------------------------------------------|
| Name               | Title       | Pangalan/caption ng post                            |
| Status             | Select      | Draft, Write, Completed, Scheduled, Idea, Design     |
| Schedule Date      | Date        | Petsa ng post                                        |
| Content pillar     | Select      | Mindset, Lifestyle, Self Care, Style Tips, etc.      |
| Source             | Select      | `notion` o `canva`                                   |
| Attachments        | Files       | Direktang upload ng image/video sa Notion            |
| Direct Links       | URL         | External link sa image/video (kung wala sa Attachments) |
| Canva Link         | URL         | Canva share link (kapag Source = canva)              |
| Include            | Checkbox    | I-check kung ipapakita sa grid (optional column, dagdag mo kung wala)|

**Kung iba ang exact pangalan ng columns mo**, sabihin mo lang sa akin ang tamang pangalan at i-update ko ang `lib/notion.js` (line na may `getTitle("Name")`, `getSelect("Status")`, etc.) para tumugma.

## 2. Notion Integration

1. notion.so/my-integrations → "New integration" → kopyahin ang **Internal Integration Secret** (`NOTION_API_KEY`)
2. Sa database page → "•••" → Connections → ikonekta ang integration
3. Kopyahin ang **Database ID** mula sa URL (32-char string bago ang `?v=`)

## 3. I-push sa GitHub

```bash
cd ig-grid-widget
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/USERNAME/ig-grid-widget.git
git push -u origin main
```

## 4. I-deploy sa Vercel

1. vercel.com → Add New Project → i-import ang repo
2. Sa Environment Variables, idagdag:
   - `NOTION_API_KEY`
   - `NOTION_DATABASE_ID`
   - `NOTION_PROFILE_USERNAME` (optional)
   - `NOTION_PROFILE_AVATAR` (optional)
3. Deploy

## 5. I-embed sa Notion

`/embed` block sa Notion page mo → paste ang Vercel URL → resize.

## Paano gumagana ang media rendering

- Kung `Source` = `canva` at meron `Canva Link` → direktang i-embed ang Canva design
- Kung meron `Direct Links` → gagamitin ito bilang image/video URL
- Kung walang Direct Links pero meron `Attachments` → gagamitin ang unang file na-upload sa Notion
- Kung 2+ files sa Attachments → ituturing na carousel (swipeable sa modal)
- Video auto-detect base sa file extension (.mp4, .mov, .webm)

## Local testing

```bash
npm install
cp .env.example .env.local
npm run dev
```
