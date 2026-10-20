// Adapted from HazeToolPlat/frontend/src/Dashboard/pages/PersonalCenter.tsx.
const AVATAR_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
export const AVATAR_MAX_LENGTH = 65_000;

export async function normalizeAvatar(file: File): Promise<string> {
  if (!AVATAR_TYPES.has(file.type)) throw new Error("仅支持 JPG、PNG、WebP 图片");
  if (file.size > 5 * 1024 * 1024) throw new Error("头像图片不能超过 5 MB");
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    try { await image.decode(); } catch { throw new Error("无法读取头像图片，请选择有效的 JPG、PNG 或 WebP 图片"); }
    const minSide = Math.min(image.naturalWidth, image.naturalHeight);
    const maxSide = Math.max(image.naturalWidth, image.naturalHeight);
    if (minSide < 128) throw new Error("头像图片分辨率不能低于 128×128");
    if (maxSide > 4096) throw new Error("头像图片最长边不能超过 4096 像素");
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("头像处理失败");
    context.drawImage(image, (image.naturalWidth - minSide) / 2, (image.naturalHeight - minSide) / 2, minSide, minSide, 0, 0, 256, 256);
    for (const quality of [0.9, 0.8, 0.7, 0.6]) {
      const avatar = canvas.toDataURL("image/jpeg", quality);
      if (avatar.length <= AVATAR_MAX_LENGTH) return avatar;
    }
    throw new Error("头像压缩后仍然过大，请选择其他图片");
  } finally {
    URL.revokeObjectURL(url);
  }
}
