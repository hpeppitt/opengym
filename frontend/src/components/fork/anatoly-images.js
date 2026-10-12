// A picked photo as inline image data for Gemini (fork OG-013). DOM-bound (Image, canvas), so it
// lives apart from the sheet and the sheet's test can swap it out.

// Phone photos run to several MB; Gemini takes 20 MB inline per request. A long side of 2048 px
// keeps a screenshot's text sharp and a handful of photos well under the limit.
const MAX_SIDE = 2048
export async function toImage(file) {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = url })
    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight))
    const c = document.createElement('canvas')
    c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale)
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
    const data = c.toDataURL('image/jpeg', 0.85)
    return { mimeType: 'image/jpeg', base64: data.slice(data.indexOf(',') + 1) }
  } finally { URL.revokeObjectURL(url) }
}
