// Dynamic Asset Scanner
// Dynamically glob all files in the assets directories from public folder
export const localBrandImages = import.meta.glob('../public/assets/brands/*.{png,jpg,jpeg,svg,webp,PNG,JPG,JPEG,SVG,WEBP}', { eager: true, query: '?url', import: 'default' });
export const localRetailerImages = import.meta.glob('../public/assets/retailers/*.{png,jpg,jpeg,svg,webp,PNG,JPG,JPEG,SVG,WEBP}', { eager: true, query: '?url', import: 'default' });
export const localHeroImages = import.meta.glob('../public/assets/images/*.{png,jpg,jpeg,svg,webp,PNG,JPG,JPEG,SVG,WEBP}', { eager: true, query: '?url', import: 'default' });
export const localLogoImages = import.meta.glob('../public/assets/logo/*.{png,jpg,jpeg,svg,webp,ico,PNG,JPG,JPEG,SVG,WEBP,ICO}', { eager: true, query: '?url', import: 'default' });

export function getCustomHeroImages(): string[] {
  const images: string[] = [];
  for (const [_, rawUrl] of Object.entries(localHeroImages)) {
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

// Return ONLY items that have actual image files
export function getActiveRetailerLogos(): { id: string; url: string }[] {
  const logos: { id: string; url: string }[] = [];
  for (const [filePath, rawUrl] of Object.entries(localRetailerImages)) {
    const url = typeof rawUrl === 'string' ? rawUrl : (rawUrl as any)?.default || '';
    if (url) {
      const id = filePath.split('/').pop()?.split('.')[0] || '';
      logos.push({ id, url });
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

