import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  ArrowLeft,
  Download,
  Package,
  ChevronLeft,
  ChevronRight,
  Filter,
  Layers,
  Sparkles,
  MessageSquare,
  ShieldCheck,
  Building2,
  Clock,
  CheckCircle2,
  Flame,
  ArrowUpRight
} from 'lucide-react';
import { CatalogProduct, BrandInfo } from './catalogPdf';
import { getBrandCoverImage, getAppLogos } from './assetsRegistry';

interface CatalogPageProps {
  products: CatalogProduct[];
  brands: BrandInfo[];
  layoutConfig: any;
  handleDownloadCatalog: (prospectName?: string, companyName?: string) => void;
  onBack: () => void;
  cachedPdfUrl?: string | null;
}

// Helper: Convert product image URL into 1:1 450px lightweight thumbnail (~20KB)
function getSquare450Thumbnail(url?: string): string {
  if (!url) return '';
  if (url.includes('i.imgur.com/')) {
    const clean = url.replace(/([sbtml])\.(png|jpg|jpeg|webp)$/i, '.$2');
    return clean.replace(/(\.[a-zA-Z0-9]+)$/, 'm$1');
  }
  return url;
}

// Helper: Instant Micro Blur Placeholder (sub-3KB 90px image)
function getMicroPlaceholder(url?: string): string {
  if (!url) return '';
  if (url.includes('i.imgur.com/')) {
    const clean = url.replace(/([sbtml])\.(png|jpg|jpeg|webp)$/i, '.$2');
    return clean.replace(/(\.[a-zA-Z0-9]+)$/, 's$1');
  }
  return url;
}

// Pallet count calculator
function getPalletCount(prod: CatalogProduct): number {
  if (prod.pallet_ctn) return Number(prod.pallet_ctn);
  const skuLower = (prod.sku || '').toLowerCase();
  const cat = (prod.product_meta?.Category || '').toLowerCase();
  const cartonNum = Number(prod.carton) || 12;

  if (skuLower.includes('1.5l')) return 48;
  if (skuLower.includes('275ml') || skuLower.includes('glass')) return 64;
  if (skuLower.includes('325') || skuLower.includes('330') || cat.includes('beverage')) return 72;
  if (skuLower.includes('100g')) return 120;
  if (skuLower.includes('150g') || skuLower.includes('200g')) return 96;
  if (skuLower.includes('400g') || cartonNum === 12) return 80;
  return 80;
}

export const CatalogPage: React.FC<CatalogPageProps> = ({
  products,
  brands,
  layoutConfig,
  handleDownloadCatalog,
  onBack,
  cachedPdfUrl
}) => {
  const { normalLogo, whiteLogo } = getAppLogos();
  // Extract all unique categories
  const categories = useMemo(() => {
    const set = new Set<string>();
    products.forEach((p) => {
      const cat = p.product_meta?.Category?.trim();
      if (cat) set.add(cat);
    });
    return Array.from(set);
  }, [products]);

  // Default to Cooking Paste (or Culinary Paste, or the first available category)
  const [selectedCategory, setSelectedCategory] = useState<string>('');

  useEffect(() => {
    if (categories.length > 0 && !selectedCategory) {
      const defaultCat = categories.find((c) => 
        c.toLowerCase().includes('cooking') || 
        c.toLowerCase().includes('paste') || 
        c.toLowerCase().includes('culinary')
      ) || categories[0];
      setSelectedCategory(defaultCat);
    }
  }, [categories, selectedCategory]);

  // Calculate unique brand count per category
  const brandCountByCategory = useMemo(() => {
    const countMap = new Map<string, number>();

    // Per category brands count
    categories.forEach(cat => {
      const bSet = new Set(products.filter(p => p.product_meta?.Category === cat).map(p => p.brands_id || 'HSG_GLOBAL'));
      countMap.set(cat, bSet.size);
    });

    return countMap;
  }, [products, categories]);

  // Filter products by selected category
  const filteredProducts = useMemo(() => {
    if (!selectedCategory) return products;
    return products.filter((p) => p.product_meta?.Category === selectedCategory);
  }, [products, selectedCategory]);

  // Group filtered products by brand and sort alphabetically by Brand Name
  const brandGroups = useMemo(() => {
    const map = new Map<string, CatalogProduct[]>();
    filteredProducts.forEach((p) => {
      const bId = p.brands_id || 'HSG_GLOBAL';
      if (!map.has(bId)) {
        map.set(bId, []);
      }
      map.get(bId)!.push(p);
    });

    const result: { brand: BrandInfo; items: CatalogProduct[] }[] = [];
    map.forEach((items, bId) => {
      const brandObj = brands.find((b) => b.id === bId) || {
        id: bId,
        display_name: (items[0]?.product_meta as any)?.Brand || items[0]?.display_name || bId,
        description: 'Authentic Southeast Asian Food & Beverage Brand.'
      };

      // Sort products alphabetically by name from left to right (A to Z)
      const sortedItems = [...items].sort((a, b) => {
        const titleA = a.product_meta?.Short_Title || a.product_meta?.Title || a.display_name || '';
        const titleB = b.product_meta?.Short_Title || b.product_meta?.Title || b.display_name || '';
        return titleA.localeCompare(titleB);
      });

      result.push({ brand: brandObj, items: sortedItems });
    });

    // Sort brands alphabetically by Brand Name
    result.sort((a, b) => (a.brand.display_name || '').localeCompare(b.brand.display_name || ''));

    return result;
  }, [filteredProducts, brands]);

  const [selectedModalProduct, setSelectedModalProduct] = useState<{
    product: CatalogProduct;
    brand: BrandInfo;
  } | null>(null);

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-900 flex flex-col selection:bg-[#d4af37] selection:text-black">
      {/* 1. TOP HEADER & BREADCRUMB BAR */}
      <header className="sticky top-0 z-50 bg-white/95 backdrop-blur-md border-b border-slate-200 shadow-xs">
        <div className="max-w-7xl mx-auto px-4 md:px-8 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              onClick={onBack}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs uppercase tracking-wider transition-all cursor-pointer active:scale-95"
              title="Return to Homepage"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back</span>
            </button>

            {normalLogo && (
              <img
                src={normalLogo}
                alt="HSG Global"
                className="h-9 w-auto max-w-[120px] sm:max-w-[150px] object-contain cursor-pointer"
                onClick={onBack}
              />
            )}
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <button
              onClick={() => handleDownloadCatalog()}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-amber-700 hover:from-amber-600 hover:to-amber-800 text-white font-extrabold text-xs uppercase tracking-wider transition-all shadow-xs active:scale-95 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Download PDF Catalog</span>
              <span className="sm:hidden">PDF</span>
            </button>
          </div>
        </div>

        {/* 2. CATEGORY FILTER TABS BAR (CENTERED, DISPLAYING BRAND QTY, NO 'CATEGORY:' LABEL, NO 'ALL' TAB) */}
        <div className="bg-[#f0f4f9] border-t border-slate-200 px-4 md:px-8 py-2.5 overflow-x-auto scrollbar-none">
          <div className="max-w-7xl mx-auto flex items-center justify-center gap-2.5 sm:gap-3">
            {/* Dynamic Category Tabs with Brand Quantities */}
            {categories.map((cat) => {
              const bCount = brandCountByCategory.get(cat) || 0;
              const isSelected = selectedCategory === cat;
              return (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-5 py-1.5 rounded-full text-xs font-bold transition-all cursor-pointer whitespace-nowrap shadow-xs active:scale-95 ${
                    isSelected
                      ? 'bg-gradient-to-r from-amber-600 to-amber-700 text-white shadow-md'
                      : 'bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 hover:border-slate-300'
                  }`}
                >
                  {cat} ({bCount})
                </button>
              );
            })}
          </div>
        </div>
      </header>

      {/* 3. MAIN CATALOG BODY (BRAND-BY-BRAND SECTIONS) */}
      <main className="flex-1 max-w-7xl mx-auto px-4 md:px-8 py-8 w-full space-y-12">
        {brandGroups.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-3xl border border-slate-200 p-8">
            <Package className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <h3 className="text-lg font-bold text-slate-800">No products found in this category</h3>
            <p className="text-xs text-slate-500 mt-1">Please select another category tab above.</p>
          </div>
        ) : (
          brandGroups.map(({ brand, items }) => (
            <BrandCatalogSection
              key={brand.id}
              brand={brand}
              items={items}
              brands={brands}
              onSelectProduct={(p, b) => setSelectedModalProduct({ product: p, brand: b })}
            />
          ))
        )}
      </main>

      {/* 3.5 SINGLE PRODUCT ITEM DISPLAY POPUP */}
      {selectedModalProduct && (
        <ProductDetailModal
          product={selectedModalProduct.product}
          brand={selectedModalProduct.brand}
          onClose={() => setSelectedModalProduct(null)}
        />
      )}

      {/* 4. FOOTER (EXACT MAIN BRAND FOOTER) */}
      <footer className="bg-[#050608] text-slate-400 py-12 px-4 md:px-8 border-t border-white/10 mt-auto">
        <div className="max-w-6xl mx-auto space-y-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6 pb-8 border-b border-white/10">
            <div className="flex items-center gap-4 text-left">
              {(whiteLogo || normalLogo) && (
                <img
                  src={whiteLogo || normalLogo}
                  alt="HSG Global"
                  className="h-12 sm:h-14 w-auto max-w-[140px] sm:max-w-[180px] object-contain shrink-0"
                />
              )}
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-extrabold text-white text-base tracking-wide">
                    HSG GLOBAL PTE. LTD.
                  </span>
                  <span className="bg-[#d4af37]/20 text-[#d4af37] border border-[#d4af37]/40 text-[10px] font-bold px-2 py-0.5 rounded">
                    UEN: 201627632D
                  </span>
                </div>
                <span className="text-[11px] text-amber-400/90 font-medium block mt-0.5">
                  {layoutConfig.footer_showcase_text || 'Official Product Catalog & Global FMCG Gateway'}
                </span>
                <span className="text-[11px] text-slate-400 block mt-0.5">
                  Global Foodservice &amp; FMCG Supermarket Distribution Gateway
                </span>
              </div>
            </div>

            <div className="flex items-center gap-3 shrink-0">
              <a
                href="https://order.hsgglobal.sg/"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-200 hover:text-white border border-white/15 hover:border-[#d4af37]/50 text-xs font-semibold tracking-wide transition-all shadow-sm active:scale-95 group"
                title="Direct B2B Order Portal (order.hsgglobal.sg)"
              >
                <Package className="w-3.5 h-3.5 text-[#d4af37] group-hover:scale-110 transition-transform" />
                <span>Order Portal</span>
                <ArrowUpRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-white transition-colors" />
              </a>
            </div>
          </div>

          {/* Bottom Row: Corporate Registration & Address Details */}
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 text-[11px] text-slate-400 text-left">
            <div>
              <p className="leading-relaxed">
                <strong className="text-slate-300">Registered Office:</strong> 9 Eunos Avenue 8A, #02-00 Stie Centre, Singapore 409461
              </p>
              <p className="text-slate-500 mt-0.5">
                Exempt Private Company Limited by Shares • Incorporated in Singapore (Est. 2016)
              </p>
            </div>
            <div className="text-slate-500 md:text-right shrink-0">
              © {new Date().getFullYear()} HSG Global Pte. Ltd. All rights reserved.
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};

// ============================================================================
// BRAND SECTION COMPONENT (Full-width Cover, Floating Logo, Title & Carousel)
// ============================================================================
interface BrandCatalogSectionProps {
  brand: BrandInfo;
  items: CatalogProduct[];
  brands: BrandInfo[];
  onSelectProduct: (product: CatalogProduct, brand: BrandInfo) => void;
}

const BrandCatalogSection: React.FC<BrandCatalogSectionProps> = ({ brand, items, brands, onSelectProduct }) => {
  const carouselRef = useRef<HTMLDivElement>(null);
  const coverImg = getBrandCoverImage(brand);
  const brandLogo = brand.logo_image || brand.logo_url || brand.logo || (items[0]?.brands_id ? `/assets/brands/${items[0].brands_id}.webp` : '');

  const scrollCarousel = (direction: 'left' | 'right') => {
    if (!carouselRef.current) return;
    const scrollAmount = carouselRef.current.clientWidth * 0.75;
    carouselRef.current.scrollBy({
      left: direction === 'left' ? -scrollAmount : scrollAmount,
      behavior: 'smooth'
    });
  };

  return (
    <section className="bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-xs hover:shadow-md transition-shadow">
      {/* 1. FULL WIDTH COVER IMAGE WITH GRADIENT OVERLAY */}
      <div className="relative w-full min-h-[195px] sm:min-h-0 sm:h-64 bg-[#0a0d14] overflow-hidden isolate flex items-end">
        {coverImg ? (
          <>
            <img
              src={coverImg}
              alt={brand.display_name}
              className="absolute inset-0 w-full h-full object-cover object-center opacity-90 transition-transform duration-700 hover:scale-105"
              loading="lazy"
            />
            {/* Dark overlay for contrast */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/45 to-transparent pointer-events-none" />
          </>
        ) : (
          <div className="absolute inset-0 w-full h-full bg-[#0a0d14]" />
        )}

        {/* Brand Banner Title & Round Logo on Cover (Desktop + Mobile) */}
        <div className="relative z-10 p-5 sm:p-7 w-full flex flex-col justify-end text-white pointer-events-none">
          {/* Transparent Logo with smooth white glow/shadow on top of Brand Title */}
          {brandLogo && (
            <div className="w-auto h-14 sm:h-16 flex items-center justify-start mb-2.5 pointer-events-auto">
              <img
                src={brandLogo}
                alt={brand.display_name}
                className="max-h-full max-w-[160px] sm:max-w-[200px] object-contain filter drop-shadow-[0_2px_8px_rgba(255,255,255,0.45)] drop-shadow-[0_4px_16px_rgba(0,0,0,0.85)]"
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                }}
              />
            </div>
          )}

          <span className="text-[10px] sm:text-xs font-bold uppercase tracking-widest text-[#d4af37] block">
            Brand Portfolio Showcase
          </span>
          <h2 className="text-xl sm:text-3xl font-extrabold text-white drop-shadow-md tracking-tight">
            {brand.display_name}
          </h2>
        </div>
      </div>

      {/* 2. BRAND INFO & CAROUSEL CONTROLS BAR */}
      <div className="relative px-5 sm:px-7 py-4 border-b border-slate-100">
        {/* Brand Description & SKU Count */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex-1 min-w-0">
            <p className="text-xs sm:text-sm text-slate-600 leading-relaxed max-w-3xl">
              {brand.description || 'Authentic traditional Southeast Asian recipes, sauces, and cooking pastes crafted for international supermarkets, commercial kitchens, and retail distribution.'}
            </p>
          </div>

          <div className="flex items-center justify-between sm:justify-end gap-2 shrink-0">
            <span className="px-3 py-1 bg-amber-50 text-amber-800 border border-amber-200 rounded-full text-xs font-bold whitespace-nowrap">
              {items.length} {items.length === 1 ? 'Product SKU' : 'Product SKUs'}
            </span>
            
            {/* Carousel Navigation Arrows Header */}
            <div className="flex items-center gap-1.5 ml-2">
              <button
                onClick={() => scrollCarousel('left')}
                className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center justify-center transition-all cursor-pointer active:scale-95 shadow-xs"
                title="Scroll Left"
                aria-label="Scroll Carousel Left"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() => scrollCarousel('right')}
                className="w-8 h-8 rounded-full bg-amber-600 hover:bg-amber-700 text-white flex items-center justify-center transition-all cursor-pointer active:scale-95 shadow-xs"
                title="Scroll Right"
                aria-label="Scroll Carousel Right"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 3. PRODUCT CAROUSEL (2 CARDS PER VIEW ON MOBILE, HORIZONTAL SCROLL ON DESKTOP) */}
      <div className="p-3.5 sm:p-6 bg-slate-50/50">
        <div
          ref={carouselRef}
          className="flex flex-nowrap overflow-x-auto snap-x snap-mandatory gap-3 sm:gap-5 scrollbar-none pb-2 scroll-smooth"
        >
          {items.map((item) => {
            const meta = item.product_meta || {};
            const rawImgSrc = item.thumbnail || item.image || (meta.Images && meta.Images[0]) || '';
            const thumbnailSrc = getSquare450Thumbnail(rawImgSrc);
            const microPlaceholderSrc = getMicroPlaceholder(rawImgSrc);
            const fallbackOriginalSrc = item.image || (meta.Images && meta.Images[0]) || '';
            const brandObj = brands.find((b) => b.id === item.brands_id);
            const brandName = brandObj ? brandObj.display_name : brand.display_name;
            const productTitle = meta.Short_Title || meta.Title || item.display_name;
            const eaCtn = item.carton || '12';
            const ctnPerPlt = getPalletCount(item);

            return (
              <div
                key={item.sku}
                onClick={() => onSelectProduct(item, brandObj || brand)}
                className="w-[calc(50%-6px)] min-w-[calc(50%-6px)] max-w-[calc(50%-6px)] sm:w-auto sm:min-w-[240px] sm:max-w-[260px] snap-start shrink-0 bg-white rounded-2xl overflow-hidden shadow-xs hover:shadow-xl transition-all duration-300 flex flex-col group border border-slate-200 animate-fadeIn cursor-pointer active:scale-[0.98]"
              >
                {/* Image Box - Flush WebP with Blur-Up */}
                <div className="h-40 sm:h-56 w-full bg-white relative overflow-hidden flex items-center justify-center">
                  {thumbnailSrc ? (
                    <>
                      {/* Micro Blur Placeholder */}
                      <img
                        src={microPlaceholderSrc || thumbnailSrc}
                        alt=""
                        aria-hidden="true"
                        className="absolute inset-0 h-full w-full object-cover filter blur-[4px] scale-105 opacity-90 pointer-events-none"
                      />
                      {/* Sharp Main Image */}
                      <img
                        src={thumbnailSrc}
                        alt={item.display_name}
                        loading="lazy"
                        onLoad={(e) => {
                          (e.currentTarget as HTMLElement).classList.remove('opacity-0');
                          (e.currentTarget as HTMLElement).classList.add('opacity-100');
                        }}
                        onError={(e) => {
                          if (fallbackOriginalSrc && e.currentTarget.src !== fallbackOriginalSrc) {
                            e.currentTarget.src = fallbackOriginalSrc;
                          }
                        }}
                        className="relative z-1 h-full w-full object-cover group-hover:scale-105 transition-all duration-500 opacity-0"
                      />
                    </>
                  ) : (
                    <Package className="w-10 h-10 text-slate-300" />
                  )}
                  <div className="absolute top-2 right-2 z-2 bg-black/75 backdrop-blur-md px-1.5 py-0.5 rounded text-[9px] sm:text-[10px] font-semibold text-[#d4af37] border border-[#d4af37]/30">
                    {brandName}
                  </div>
                </div>

                {/* Content Box */}
                <div className="p-3 sm:p-4 flex-1 flex flex-col justify-between bg-white">
                  <div>
                    <h4 className="font-bold text-[#0f172a] text-xs sm:text-sm leading-snug group-hover:text-amber-700 transition-colors line-clamp-2 min-h-[32px] sm:min-h-[38px]">
                      {productTitle}
                    </h4>
                  </div>

                  {/* Clean Specifications Grid */}
                  <div className="mt-3 pt-2.5 border-t border-slate-100 grid grid-cols-2 gap-y-1 text-[10px] sm:text-xs text-[#0284c7] font-medium">
                    <div className="text-left font-semibold">
                      {eaCtn} EA / CTN
                    </div>
                    <div className="text-right font-semibold">
                      {ctnPerPlt} CTN / PLT
                    </div>
                    <div className="text-left text-slate-500">
                      15°–25°C
                    </div>
                    <div className="text-right text-slate-500">
                      24 Months
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};

// ============================================================================
// SINGLE PRODUCT ITEM DISPLAY POPUP MODAL (Multi-Photo, Short_Des, Specs, Long_Des)
// ============================================================================
interface ProductDetailModalProps {
  product: CatalogProduct;
  brand: BrandInfo;
  onClose: () => void;
}

const ProductDetailModal: React.FC<ProductDetailModalProps> = ({ product, brand, onClose }) => {
  const meta = product.product_meta || {};
  const brandLogo = brand.logo_image || brand.logo_url || brand.logo || (product.brands_id ? `/assets/brands/${product.brands_id}.webp` : '');
  
  // Extract all available photo URLs
  const photoList = useMemo(() => {
    const list: string[] = [];
    if (meta.Images && Array.isArray(meta.Images)) {
      meta.Images.forEach((img: string) => {
        if (img && typeof img === 'string' && img.trim()) list.push(img.trim());
      });
    }
    if (product.image && !list.includes(product.image)) {
      list.unshift(product.image);
    }
    if (product.thumbnail && !list.includes(product.thumbnail)) {
      list.push(product.thumbnail);
    }
    return list.length > 0 ? list : [''];
  }, [meta.Images, product.image, product.thumbnail]);

  const [activePhotoIdx, setActivePhotoIdx] = useState(0);

  // Close modal on Escape key press
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const title = meta.Title || meta.Short_Title || product.display_name;
  const shortTitle = meta.Short_Title || title;
  const shortDes = meta.Short_Des || '';
  const longDes = meta.Long_Des || '';
  const eaCtn = product.carton || '12';
  const ctnPerPlt = getPalletCount(product);
  const storage = product.storage_condition || '15°–25°C';
  const shelfLife = product.shelf_life || '24 Months';
  const singleBarcode = product.single_barcode || '';
  const cartonBarcode = product.carton_barcode || '';
  const weight = product.carton_weight || '';

  return (
    <div className="fixed inset-0 z-50 bg-black/65 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 animate-fadeIn overflow-y-auto" onClick={onClose}>
      <div
        className="relative bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-2xl w-full overflow-hidden flex flex-col my-auto max-h-[90vh] animate-scaleUp"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header Bar */}
        <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            {brandLogo && (
              <img src={brandLogo} alt={brand.display_name} className="w-6 h-6 object-contain rounded-full border border-slate-200" />
            )}
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-900">{brand.display_name}</span>
              <span className="text-slate-300">•</span>
              <span className="text-[11px] font-mono text-slate-500 font-medium">SKU: {product.sku}</span>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-7 h-7 rounded-full hover:bg-slate-100 text-slate-500 flex items-center justify-center transition-colors cursor-pointer"
            title="Close (Esc)"
          >
            <span className="text-lg leading-none font-bold">&times;</span>
          </button>
        </div>

        {/* Modal Body - Flat Clean Structure */}
        <div className="p-5 overflow-y-auto space-y-5 flex-1 divide-y divide-slate-100">
          {/* Top Section: Photo (Flush, No Extra Container Padding) + Core Details */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 items-start">
            {/* 1. Flush Photo & Thumbnails */}
            <div className="space-y-2">
              <div className="relative w-full aspect-square bg-slate-50 rounded-xl overflow-hidden flex items-center justify-center border border-slate-100">
                {photoList[activePhotoIdx] ? (
                  <img
                    src={photoList[activePhotoIdx]}
                    alt={title}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <Package className="w-12 h-12 text-slate-300" />
                )}

                {photoList.length > 1 && (
                  <div className="absolute bottom-2 right-2 bg-black/70 text-white text-[9px] font-bold px-1.5 py-0.5 rounded">
                    {activePhotoIdx + 1} / {photoList.length}
                  </div>
                )}
              </div>

              {/* Thumbnails if multiple */}
              {photoList.length > 1 && (
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
                  {photoList.map((url, idx) => (
                    <button
                      key={idx}
                      onClick={() => setActivePhotoIdx(idx)}
                      className={`w-11 h-11 rounded-lg overflow-hidden shrink-0 border transition-all cursor-pointer ${
                        activePhotoIdx === idx ? 'border-amber-600 ring-1 ring-amber-600' : 'border-slate-200 opacity-60 hover:opacity-100'
                      }`}
                    >
                      <img src={url} alt="" className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* 2. Titles, Short Description & Clean Flat Specs */}
            <div className="space-y-3">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700">
                  {product.product_meta?.Category || 'Authentic Food & Beverage'}
                </span>
                <h3 className="text-base sm:text-lg font-bold text-slate-950 leading-snug mt-0.5">
                  {title}
                </h3>
                {shortTitle && shortTitle !== title && (
                  <p className="text-xs text-slate-500">{shortTitle}</p>
                )}
              </div>

              {/* Short Description */}
              {shortDes && (
                <p className="text-xs text-slate-600 leading-relaxed">
                  {shortDes}
                </p>
              )}

              {/* Flat Specifications Table / Key-Value List */}
              <div className="pt-2 border-t border-slate-100 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                <div>
                  <span className="text-[10px] text-slate-400 block">Packaging (UOM)</span>
                  <span className="font-semibold text-slate-800">{eaCtn} EA / CTN</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 block">Pallet Config</span>
                  <span className="font-semibold text-slate-800">{ctnPerPlt} CTN / PLT</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 block">Storage</span>
                  <span className="font-medium text-slate-700">{storage}</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 block">Shelf Life</span>
                  <span className="font-medium text-slate-700">{shelfLife}</span>
                </div>
                {singleBarcode && (
                  <div className="col-span-2 pt-1 font-mono text-[11px] text-slate-600">
                    <span className="text-[10px] font-sans text-slate-400 block">Barcode (EAN-13):</span>
                    <span>{singleBarcode}</span>
                  </div>
                )}
                {cartonBarcode && (
                  <div className="col-span-2 font-mono text-[11px] text-slate-600">
                    <span className="text-[10px] font-sans text-slate-400 block">Carton Barcode (ITF-14):</span>
                    <span>{cartonBarcode}</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 3. Long Description Story (Direct text, flat) */}
          {longDes && (
            <div className="pt-4 space-y-1.5">
              <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                Product Details &amp; Story
              </h4>
              <p className="text-xs sm:text-sm text-slate-600 leading-relaxed whitespace-pre-line">
                {longDes}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
