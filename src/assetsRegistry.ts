// Dynamic Asset Scanner
// Dynamically glob all files in the assets directories from public folder
export const localBrandImages = import.meta.glob('../public/assets/brands/*.{png,jpg,jpeg,svg,webp,PNG,JPG,JPEG,SVG,WEBP}', { eager: true, query: '?url', import: 'default' });
export const localRetailerImages = import.meta.glob('../public/assets/retailers/*.{png,jpg,jpeg,svg,webp,PNG,JPG,JPEG,SVG,WEBP}', { eager: true, query: '?url', import: 'default' });
export const localHeroImages = import.meta.glob('../public/assets/images/*.{png,jpg,jpeg,svg,webp,PNG,JPG,JPEG,SVG,WEBP}', { eager: true, query: '?url', import: 'default' });
export const localLogoImages = import.meta.glob('../public/assets/logo/*.{png,jpg,jpeg,svg,webp,ico,PNG,JPG,JPEG,SVG,WEBP,ICO}', { eager: true, query: '?url', import: 'default' });

export function getCustomHeroImages(): string[] {
  const images: string[] = [];
  for (const [filePath, rawUrl] of Object.entries(localHeroImages)) {
    if (filePath.includes('-blur')) continue;
    const url = typeof rawUrl === 'string' ? rawUrl : (rawUrl as any)?.default || '';
    if (url) images.push(url);
  }
  return images;
}

// Logo Helpers: white logo, normal logo, favicon
export function getAppLogos(): { normalLogo: string; whiteLogo: string; favicon: string } {
  let normalLogo = '';
  let whiteLogo = '';
  let favicon = '';

  for (const [filePath, rawUrl] of Object.entries(localLogoImages)) {
    const url = typeof rawUrl === 'string' ? rawUrl : (rawUrl as any)?.default || '';
    const fileName = filePath.split('/').pop()?.toLowerCase() || '';

    if (fileName.includes('favicon')) {
      favicon = url;
    } else if (fileName.includes('white') || fileName.includes('footer') || fileName.includes('light')) {
      whiteLogo = url;
    } else if (fileName.includes('normal') || fileName.includes('top') || fileName.includes('main') || fileName.includes('logo')) {
      normalLogo = url;
    }
  }

  // Fallbacks if any single logo is provided
  const allUrls = Object.values(localLogoImages).map(v => typeof v === 'string' ? v : (v as any)?.default || '').filter(Boolean);
  if (!normalLogo && allUrls.length > 0) normalLogo = allUrls[0];
  if (!whiteLogo && normalLogo) whiteLogo = normalLogo;
  if (!favicon && normalLogo) favicon = normalLogo;

  return { normalLogo, whiteLogo, favicon };
}

export interface LogoItem {
  id: string;
  name: string;
  category?: string;
  subtitle?: string;
  logo: string;
}

// Return ONLY items that have actual image files with group metadata
export function getActiveRetailerLogos(): { id: string; url: string; group?: string }[] {
  const logos: { id: string; url: string; group?: string }[] = [];
  for (const [filePath, rawUrl] of Object.entries(localRetailerImages)) {
    const url = typeof rawUrl === 'string' ? rawUrl : (rawUrl as any)?.default || '';
    if (url) {
      const id = filePath.split('/').pop()?.split('.')[0] || '';
      logos.push({ id, url, group: 'Global Partners' });
    }
  }
  return logos;
}

export function getActiveBrandLogos(): { id: string; url: string; name?: string }[] {
  const logos: { id: string; url: string; name?: string }[] = [];
  for (const [filePath, rawUrl] of Object.entries(localBrandImages)) {
    const url = typeof rawUrl === 'string' ? rawUrl : (rawUrl as any)?.default || '';
    if (url) {
      const id = filePath.split('/').pop()?.split('.')[0] || '';
      logos.push({ id, url });
    }
  }
  return logos;
}

// Brand Cover Image Resolver (Finds actual cover_img from brand data; returns empty if none exists)
export function getBrandCoverImage(brand: { id?: string; display_name?: string; cover_img?: string; Cover_Image?: string; [key: string]: any }): string {
  if (brand.cover_img && typeof brand.cover_img === 'string' && brand.cover_img.trim()) return brand.cover_img.trim();
  if (brand.Cover_Image && typeof brand.Cover_Image === 'string' && brand.Cover_Image.trim()) return brand.Cover_Image.trim();
  if (brand.cover_image && typeof brand.cover_image === 'string' && brand.cover_image.trim()) return brand.cover_image.trim();
  if (brand.banner_image && typeof brand.banner_image === 'string' && brand.banner_image.trim()) return brand.banner_image.trim();

  // Return empty string (no fallback to other images or hero images)
  return '';
}

