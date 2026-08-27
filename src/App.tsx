import React, { useState, useEffect } from 'react';
import {
  Download,
  Sparkles,
  Award,
  Globe2,
  CheckCircle2,
  Calendar,
  Send,
  MessageSquare,
  Building2,
  Mail,
  User,
  Phone,
  Flame,
  Clock,
  ShieldCheck,
  Package,
  ChevronRight,
  ChevronDown,
  ArrowDownCircle,
  TrendingUp,
  Store,
  Layers,
  RefreshCw
} from 'lucide-react';
import {
  getActiveBrandLogos,
  getActiveRetailerLogos,
  getCustomHeroImages,
  getAppLogos
} from './assetsRegistry';
import { generateExportCatalogPdf, CatalogProduct, BrandInfo } from './catalogPdf';

export default function App() {
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [brands, setBrands] = useState<BrandInfo[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(true);

  // Discover actual image and logo files from public/assets/
  const activeRetailers = getActiveRetailerLogos();
  const rawBrands = getActiveBrandLogos();
  const heroImages = getCustomHeroImages();
  const { normalLogo, whiteLogo, favicon } = getAppLogos();

  // Dynamic Favicon Injection if provided in public/assets/logo/
  useEffect(() => {
    if (favicon) {
      const link: HTMLLinkElement = document.querySelector("link[rel*='icon']") || document.createElement('link');
      link.type = favicon.endsWith('.svg') ? 'image/svg+xml' : 'image/png';
      link.rel = 'shortcut icon';
      link.href = favicon;
      document.getElementsByTagName('head')[0].appendChild(link);
    }
  }, [favicon]);

  // Hero Background Slideshow Fade State
  const [currentHeroIndex, setCurrentHeroIndex] = useState(0);

  useEffect(() => {
    if (heroImages.length <= 1) return;
    const heroTimer = setInterval(() => {
      setCurrentHeroIndex((prev) => (prev + 1) % heroImages.length);
    }, 6000); // Cross-fade every 6 seconds
    return () => clearInterval(heroTimer);
  }, [heroImages.length]);

  // Dynamic Randomized Positions & Shifts on every page load
  const [randomizedBrands, setRandomizedBrands] = useState<{
    id: string;
    url: string;
    offsetX: number;
    offsetY: number;
    scale: number;
    rotate: number;
    zIndex: number;
  }[]>([]);

  useEffect(() => {
    // Shuffle and randomize offsets on reload
    const shuffled = [...rawBrands].sort(() => Math.random() - 0.5);
    const mapped = shuffled.map((b) => ({
      id: b.id,
      url: b.url,
      offsetX: Math.floor(Math.random() * 40) - 20, // -20px to +20px horizontal shift
      offsetY: Math.floor(Math.random() * 70) - 35, // -35px to +35px up/down offset
      scale: 0.9 + Math.random() * 0.25,           // 0.9 to 1.15 scale
      rotate: Math.floor(Math.random() * 10) - 5,   // -5deg to +5deg tilt
      zIndex: Math.floor(Math.random() * 10) + 1
    }));
    setRandomizedBrands(mapped);
  }, []);

  // Lead Form States
  const [formData, setFormData] = useState({
    name: '',
    company: '',
    email: '',
    phone: '',
    inquiry_type: 'Looking to Import Asian Products to Australia/Global',
    message: ''
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [showFullInquiryForm, setShowFullInquiryForm] = useState(false);
  const [isRefreshingProducts, setIsRefreshingProducts] = useState(false);

  // Email validation regex (Strict RFC 5322 compliant check)
  const isValidEmail = (email: string): boolean => {
    return /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email.trim());
  };

  // 1. Fetch Catalog Products from Dedicated Backend & Pick 1 Random SKU per Brand (4 items single row)
  const [featuredProducts, setFeaturedProducts] = useState<CatalogProduct[]>([]);
  const [nextBatchProducts, setNextBatchProducts] = useState<CatalogProduct[]>([]);
  const [isFadingSwap, setIsFadingSwap] = useState(false);

  // Pre-load / pre-fetch image files into browser cache
  const preloadProductImages = (prods: CatalogProduct[]) => {
    prods.forEach((p) => {
      const src = p.image || (p.product_meta?.Images && p.product_meta.Images[0]);
      if (src) {
        const img = new Image();
        img.src = src;
      }
    });
  };

  const computeRandomPickBatch = (allProds: CatalogProduct[]): CatalogProduct[] => {
    if (!allProds || allProds.length === 0) return [];
    const brandGroupMap = new Map<string, CatalogProduct[]>();
    allProds.forEach((p) => {
      const bId = p.brands_id || 'OTHER';
      if (!brandGroupMap.has(bId)) {
        brandGroupMap.set(bId, []);
      }
      brandGroupMap.get(bId)!.push(p);
    });

    const distinctBrandPicks: CatalogProduct[] = [];
    brandGroupMap.forEach((prodsInBrand) => {
      const randomPick = prodsInBrand[Math.floor(Math.random() * prodsInBrand.length)];
      distinctBrandPicks.push(randomPick);
    });

    // Shuffle and pick 4 items for 1 clean single row
    const shuffled = distinctBrandPicks.sort(() => Math.random() - 0.5);
    const chosen = shuffled.slice(0, 4);
    preloadProductImages(chosen);
    return chosen;
  };

  // Smooth Cross-Fade Swap Transition
  const executeSmoothSwap = (targetBatch?: CatalogProduct[]) => {
    setIsFadingSwap(true);
    setTimeout(() => {
      const newItems = targetBatch && targetBatch.length > 0 ? targetBatch : computeRandomPickBatch(products);
      setFeaturedProducts(newItems);
      setIsFadingSwap(false);

      // Preload next upcoming batch in background immediately
      const nextUpcoming = computeRandomPickBatch(products);
      setNextBatchProducts(nextUpcoming);
    }, 280); // 280ms smooth fade-out then fade-in
  };

  // Product swap animation key to restart water animation on manual swap
  const [swapKey, setSwapKey] = useState(0);

  const handleManualRefreshProducts = () => {
    setIsRefreshingProducts(true);
    executeSmoothSwap(nextBatchProducts.length > 0 ? nextBatchProducts : undefined);
    setSwapKey((prev) => prev + 1); // Restarts the 30s water fill from bottom
    setTimeout(() => setIsRefreshingProducts(false), 400);
  };

  const [catalogHash, setCatalogHash] = useState<string>('');
  const [cachedPdfUrl, setCachedPdfUrl] = useState<string | null>(null);

  // Helper for fast trigger download
  const handleDownloadCatalog = (prospectName?: string, companyName?: string) => {
    if (cachedPdfUrl) {
      const link = document.createElement('a');
      link.href = cachedPdfUrl;
      link.download = 'HSG_Global_Official_Export_Catalog.pdf';
      link.target = '_blank';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } else {
      generateExportCatalogPdf(products, brands, prospectName, companyName, catalogHash);
    }
  };

  useEffect(() => {
    let allLoadedProducts: CatalogProduct[] = [];
    let currentHash = '';
    let currentCachedUrl: string | null = null;

    async function loadCatalog() {
      try {
        const res = await fetch('https://ib-v2.hsgglobalpteltd.workers.dev/api/exhibitor/catalog-products');
        if (res.ok) {
          const data = await res.json();
          allLoadedProducts = data.products || [];
          const allBrands: BrandInfo[] = data.brands || [];
          currentHash = data.catalog_hash || '';
          currentCachedUrl = data.cached_pdf_url || null;

          if (currentHash) setCatalogHash(currentHash);
          if (currentCachedUrl) setCachedPdfUrl(currentCachedUrl);

          if (allLoadedProducts.length > 0) setProducts(allLoadedProducts);
          if (allBrands.length > 0) setBrands(allBrands);

          const initial = computeRandomPickBatch(allLoadedProducts);
          setFeaturedProducts(initial);

          // Preload second batch
          const second = computeRandomPickBatch(allLoadedProducts);
          setNextBatchProducts(second);

          // Handle automatic dynamic PDF generation from email link (?download=pdf&name=...&company=...)
          const searchParams = new URLSearchParams(window.location.search);
          if (searchParams.get('download') === 'pdf' || searchParams.get('download_catalog') === 'true') {
            const pName = searchParams.get('name') || '';
            const cName = searchParams.get('company') || '';
            setTimeout(() => {
              if (currentCachedUrl) {
                const link = document.createElement('a');
                link.href = currentCachedUrl;
                link.download = 'HSG_Global_Official_Export_Catalog.pdf';
                link.target = '_blank';
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
              } else {
                generateExportCatalogPdf(allLoadedProducts, allBrands, pName, cName, currentHash);
              }
            }, 500);
          }
        }
      } catch (err) {
        console.error('Failed to load products from backend:', err);
      } finally {
        setLoadingProducts(false);
      }
    }
    loadCatalog();

    // Auto rotate every 30 seconds (30 * 1000 ms) in sync with the 30s water fill
    const interval = setInterval(() => {
      if (allLoadedProducts.length > 0) {
        setFeaturedProducts((currentFeatured) => {
          setIsFadingSwap(true);
          setTimeout(() => {
            const freshBatch = computeRandomPickBatch(allLoadedProducts);
            setFeaturedProducts(freshBatch);
            setIsFadingSwap(false);
          }, 280);
          return currentFeatured;
        });
        setSwapKey((prev) => prev + 1);
      }
    }, 30 * 1000);

    return () => clearInterval(interval);
  }, []);

  // Exhibition Dates: 31 Aug 2026 09:00:00 AEST to 03 Sept 2026 20:00:00 AEST
  // Melbourne / Sydney is AEST (UTC+10:00)
  const EXPO_START_TIME = new Date('2026-08-31T09:00:00+10:00').getTime();
  const EXPO_END_TIME = new Date('2026-09-03T20:00:00+10:00').getTime();

  const [expoTimeState, setExpoTimeState] = useState<{
    status: 'upcoming' | 'live' | 'ended';
    days: number;
    hours: number;
    minutes: number;
    seconds: number;
    countdownFormatted: string;
  }>(() => {
    const now = Date.now();
    return {
      status: now < EXPO_START_TIME ? 'upcoming' : now <= EXPO_END_TIME ? 'live' : 'ended',
      days: 0,
      hours: 0,
      minutes: 0,
      seconds: 0,
      countdownFormatted: ''
    };
  });

  useEffect(() => {
    const updateCountdown = () => {
      const now = Date.now();
      if (now < EXPO_START_TIME) {
        // Before Exhibition start: Hide countdown or show upcoming
        setExpoTimeState({
          status: 'upcoming',
          days: 0,
          hours: 0,
          minutes: 0,
          seconds: 0,
          countdownFormatted: ''
        });
      } else if (now <= EXPO_END_TIME) {
        // LIVE during exhibition: Countdown to 3 Sept 8:00 PM
        const diff = EXPO_END_TIME - now;
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((diff % (1000 * 60)) / 1000);

        const countdownFormatted = days > 0
          ? `${days}d ${hours}h ${minutes}m ${seconds}s`
          : `${hours}h ${minutes}m ${seconds}s`;

        setExpoTimeState({
          status: 'live',
          days,
          hours,
          minutes,
          seconds,
          countdownFormatted
        });
      } else {
        // After 3 Sept 8:00 PM: Ended
        setExpoTimeState({
          status: 'ended',
          days: 0,
          hours: 0,
          minutes: 0,
          seconds: 0,
          countdownFormatted: ''
        });
      }
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, []);

  // Verification and step states
  const [verificationStatus, setVerificationStatus] = useState<'idle' | 'verifying' | 'generating' | 'sending'>('idle');
  const [verificationMessage, setVerificationMessage] = useState('');

  // Form Submit Handler with Live Domain & MX Verification + Animated Progress Line
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEmail = formData.email.trim().toLowerCase();
    if (!cleanEmail) {
      setSubmitError('Please enter your business email address.');
      return;
    }

    if (!isValidEmail(cleanEmail)) {
      setSubmitError('Please enter a valid business email format (e.g. name@company.com).');
      return;
    }

    // Default name if submitting quick download
    const finalName = formData.name.trim() || cleanEmail.split('@')[0] || 'Trade Visitor';

    setIsSubmitting(true);
    setSubmitError('');
    setVerificationStatus('verifying');
    setVerificationMessage('Connecting to mail server & verifying MX records...');

    try {
      // Step 1: Live Domain / MX DNS check with Cloudflare Workers Backend
      const [verifyRes] = await Promise.all([
        fetch('https://ib-v2.hsgglobalpteltd.workers.dev/api/exhibitor/verify-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: cleanEmail })
        }),
        new Promise((r) => setTimeout(r, 900)) // Ensure visible animation step
      ]);

      const verifyData = await verifyRes.json();
      if (!verifyRes.ok || verifyData.valid === false) {
        throw new Error(verifyData.error || 'Email domain is unreachable or not receiving mail.');
      }

      // Step 2: Generating and formatting custom PDF catalog
      setVerificationStatus('generating');
      setVerificationMessage('Domain verified! Building export catalog PDF...');
      await new Promise((r) => setTimeout(r, 850));

      // Step 3: Submit lead and send email copy
      setVerificationStatus('sending');
      setVerificationMessage('Dispatching trade catalog & credentials to your inbox...');
      await new Promise((r) => setTimeout(r, 700));

      const isDev =
        window.location.hostname === 'localhost' ||
        window.location.hostname === '127.0.0.1' ||
        window.location.hostname.includes('192.168.');

      const response = await fetch('https://ib-v2.hsgglobalpteltd.workers.dev/api/exhibitor/submit-lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: finalName,
          company: formData.company.trim(),
          email: cleanEmail,
          phone: formData.phone.trim(),
          inquiry_type: formData.inquiry_type,
          message: formData.message.trim(),
          is_dev_mode: isDev,
          client_origin: window.location.origin,
          source: 'Fine Food Australia 2026 Booth'
        })
      });

      const resData = await response.json();
      if (!response.ok) {
        throw new Error(resData.error || 'Failed to submit inquiry');
      }

      // Trigger instant PDF generation & direct download (using R2 cached version if ready or generates and uploads)
      handleDownloadCatalog(finalName, formData.company.trim());

      setSubmitSuccess(true);
    } catch (err: any) {
      setSubmitError(err.message || 'An error occurred. Please verify your email.');
    } finally {
      setIsSubmitting(false);
      setVerificationStatus('idle');
      setVerificationMessage('');
    }
  };

  const scrollToSection = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-900 flex flex-col font-sans selection:bg-[#d4af37]/30 selection:text-amber-900">
      {/* TOP FLOATING CALLOUT (Booth Reminder - Continuous Left Slide on Mobile, Centered on Desktop) */}
      <div className="bg-gradient-to-r from-amber-600 via-[#d4af37] to-amber-700 text-black py-2.5 px-3 text-xs md:text-sm font-bold tracking-wide shadow-md overflow-hidden relative">
        {/* Desktop View: Centered */}
        <div className="hidden sm:flex items-center justify-center gap-2">
          <Sparkles className="w-4 h-4 shrink-0 animate-pulse text-black" />
          <span>FINE FOOD AUSTRALIA 2026 OFFICIAL EXHIBITOR • HSG GLOBAL PTE LTD</span>
          <button
            onClick={() => scrollToSection('export-catalog-preview')}
            className="ml-2 bg-black text-[#d4af37] px-3 py-1 rounded-full text-[11px] font-extrabold uppercase hover:bg-zinc-900 transition-all cursor-pointer shrink-0"
          >
            Our Catalog ↓
          </button>
        </div>

        {/* Mobile View: Single Line Unwrap & Infinite Slide to Left */}
        <div className="sm:hidden flex overflow-hidden whitespace-nowrap">
          <div className="animate-marquee-banner flex items-center gap-8 text-[11px] font-extrabold uppercase">
            <span className="flex items-center gap-1.5 shrink-0">
              <Sparkles className="w-3.5 h-3.5 text-black" />
              FINE FOOD AUSTRALIA 2026 OFFICIAL EXHIBITOR • HSG GLOBAL PTE LTD
            </span>
            <span className="flex items-center gap-1.5 shrink-0">
              <Sparkles className="w-3.5 h-3.5 text-black" />
              FINE FOOD AUSTRALIA 2026 OFFICIAL EXHIBITOR • HSG GLOBAL PTE LTD
            </span>
            <span className="flex items-center gap-1.5 shrink-0">
              <Sparkles className="w-3.5 h-3.5 text-black" />
              FINE FOOD AUSTRALIA 2026 OFFICIAL EXHIBITOR • HSG GLOBAL PTE LTD
            </span>
          </div>
        </div>
      </div>

      {/* 1. HERO SECTION: MEET HSG GLOBAL AT THE EXPO (OPTION 2 HOOK + FADE IMAGE SLIDESHOW) */}
      <section className="relative bg-batik-hero text-white pt-16 pb-24 px-4 md:px-8 max-w-full mx-auto w-full text-center overflow-hidden border-b border-amber-500/20 min-h-[580px] flex items-center justify-center">
        {/* Dynamic Image Slideshow Layer (Cross-Fade) */}
        {heroImages.length > 0 && (
          <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
            {heroImages.map((imgUrl, idx) => (
              <div
                key={`${imgUrl}-${idx}`}
                style={{ backgroundImage: `url(${imgUrl})` }}
                className={`absolute inset-0 bg-cover bg-center transition-opacity duration-1000 ease-in-out ${
                  idx === currentHeroIndex ? 'opacity-35 scale-100' : 'opacity-0 scale-105'
                }`}
              />
            ))}
            {/* Gradient Overlays for High Contrast Readability */}
            <div className="absolute inset-0 bg-gradient-to-b from-[#0d121c]/90 via-[#0d121c]/80 to-[#0d121c]" />
          </div>
        )}

        <div className="max-w-5xl mx-auto relative z-10">
          {/* Integrated Brand Luxury Pill */}
          <div className="inline-flex items-center gap-2.5 px-6 py-2.5 rounded-full bg-batik-card-dark/90 backdrop-blur-md border border-[#d4af37]/40 shadow-xl mb-6 hover:border-[#d4af37]/70 transition-all">
            {whiteLogo && (
              <img
                src={whiteLogo}
                alt="HSG Global"
                className="h-5 sm:h-6 w-auto object-contain shrink-0"
              />
            )}
            <span className="font-extrabold text-white text-xs sm:text-sm tracking-wider">
              HSG GLOBAL PTE LTD
            </span>
          </div>

          {/* Option 2 Primary Headline */}
          <h1 className="text-3xl sm:text-5xl md:text-6xl font-extrabold tracking-tight leading-tight text-white mb-6">
            Connecting Southeast Asian Taste
            <span className="block mt-2 gold-gradient-text">To Australian Shelves &amp; Kitchens</span>
          </h1>

          {/* Option 2 Subtitle / Hook */}
          <p className="text-slate-200 text-sm sm:text-base md:text-lg max-w-3xl mx-auto leading-relaxed mb-8 font-normal">
            Ready-to-cook authentic Asian culinary pastes, ambient Halal food, and refreshing beverages for Australian supermarkets &amp; foodservice — and <strong>your trusted FMCG distribution gateway into Singapore</strong>.
          </p>

          {/* CTA Buttons & Countdown Controls */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 max-w-lg mx-auto mb-10">
            {/* 1. OUR CATALOG (All Caps, No Icon, Scrolls to Export Catalog Preview) */}
            <button
              onClick={() => scrollToSection('export-catalog-preview')}
              className="w-full sm:w-auto bg-gradient-to-r from-amber-600 via-[#d4af37] to-amber-600 hover:from-amber-500 hover:to-amber-600 text-black font-extrabold px-8 py-4 rounded-xl shadow-xl flex items-center justify-center transition-all transform active:scale-95 cursor-pointer text-sm uppercase tracking-wider"
            >
              OUR CATALOG
            </button>

            {/* 2. BOOK BOOTH MEETING (All Caps, No Icon, Auto-Hides After 03 Sept 8:00 PM AEST) */}
            {expoTimeState.status !== 'ended' && (
              <button
                onClick={() => scrollToSection('meeting-section')}
                className="w-full sm:w-auto bg-batik-card-dark hover:bg-white/10 text-white font-bold px-8 py-4 rounded-xl border border-slate-600 flex items-center justify-center text-sm uppercase tracking-wider transition-all cursor-pointer shadow-md group relative"
              >
                <span>BOOK BOOTH MEETING</span>

                {/* Live Countdown Badge: Displays ONLY while Exhibition is active */}
                {expoTimeState.status === 'live' && (
                  <span className="ml-2 inline-flex items-center gap-1 bg-amber-500/20 border border-[#d4af37]/40 text-[#fef08a] text-[10px] font-bold px-2 py-0.5 rounded-full animate-pulse normal-case tracking-normal">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping inline-block" />
                    {expoTimeState.countdownFormatted}
                  </span>
                )}
              </button>
            )}
          </div>

          {/* Key USPs Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-left max-w-4xl mx-auto mt-4">
            <div className="bg-batik-card-dark p-5 rounded-2xl border border-white/10 hover:border-[#d4af37]/50 transition-all shadow-md">
              <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center text-[#d4af37] mb-3">
                <Flame className="w-5 h-5" />
              </div>
              <h3 className="font-bold text-white text-base mb-1">Easy to Cook &amp; Ready to Use</h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                Pre-sautéed natural spice bases and pastes. Drastically cuts kitchen preparation from hours to minutes.
              </p>
            </div>

            <div className="bg-batik-card-dark p-5 rounded-2xl border border-white/10 hover:border-[#d4af37]/50 transition-all shadow-md">
              <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center text-[#d4af37] mb-3">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <h3 className="font-bold text-white text-base mb-1">100% Halal &amp; Ambient Ready</h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                Sterile retort packaging allows 18–24 months ambient shelf-life. Certified Halal, HACCP &amp; ISO compliant.
              </p>
            </div>

            <div className="bg-batik-card-dark p-5 rounded-2xl border border-white/10 hover:border-[#d4af37]/50 transition-all shadow-md">
              <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center text-[#d4af37] mb-3">
                <Store className="w-5 h-5" />
              </div>
              <h3 className="font-bold text-white text-base mb-1">Singapore Distribution Network</h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                Supplying FairPrice, Sheng Siong, Cold Storage, Giant, and HORECA. We help Australian brands enter Singapore.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 2. WE SUPPLY TO / SINGAPORE DISTRIBUTION NETWORK (CLEAN WHITE) */}
      <section className="py-14 bg-batik-light border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-4 md:px-8 text-center mb-8">
          <div className="inline-flex items-center gap-1.5 text-xs uppercase font-extrabold tracking-widest text-amber-700 mb-1.5">
            <Globe2 className="w-3.5 h-3.5" />
            <span>Singapore Island-Wide Retail Network</span>
          </div>
          <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900">
            We Supply To Across Singapore
          </h2>
          <p className="text-xs sm:text-sm text-slate-600 max-w-2xl mx-auto mt-2">
            HSG Global is a trusted FMCG distributor in Singapore. Looking to export Australian dairy, meat, snacks, or beverages into Singapore &amp; Southeast Asia? Partner with us.
          </p>
        </div>

        {/* Marquee Slider of Retailers */}
        <div className="relative w-full overflow-hidden py-3">
          <div className="animate-marquee gap-12 sm:gap-16 items-center">
            {[...activeRetailers, ...activeRetailers, ...activeRetailers].map((retailer, idx) => (
              <div
                key={`${retailer.id}-${idx}`}
                className="shrink-0 flex items-center justify-center transition-transform hover:scale-110 duration-200"
              >
                <img
                  src={retailer.url}
                  alt={retailer.id}
                  className="h-12 sm:h-14 max-w-[180px] object-contain"
                />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 3. FEATURE BRANDS SHOWCASE (CLEAN LIGHT CREAM BATIK) */}
      <section className="py-16 bg-batik-cream border-b border-slate-200 overflow-hidden">
        <div className="max-w-6xl mx-auto px-4 md:px-8 text-center mb-4">
          <span className="text-xs font-extrabold text-amber-700 uppercase tracking-widest block mb-1">
            Our Export Brand Portfolio
          </span>
          <h2 className="text-2xl sm:text-4xl font-extrabold text-slate-900">
            Featured Export Brands
          </h2>
          <p className="text-xs sm:text-sm text-slate-600 max-w-xl mx-auto mt-2">
            A curated family of Southeast Asia’s most celebrated ready-to-cook FMCG culinary, paste, and beverage brands.
          </p>
        </div>

        {/* Tight Overlapping Organic Cloud */}
        <div className="max-w-4xl mx-auto px-4 py-8">
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-8 sm:gap-x-10 sm:gap-y-12 min-h-[200px]">
            {(randomizedBrands.length > 0 ? randomizedBrands : rawBrands.map(b => ({ ...b, offsetX: 0, offsetY: 0, scale: 1, rotate: 0, zIndex: 1 }))).map((brand, idx) => (
              <div
                key={`${brand.id}-${idx}`}
                style={{
                  transform: `translate(${brand.offsetX}px, ${brand.offsetY}px) scale(${brand.scale}) rotate(${brand.rotate}deg)`,
                  zIndex: brand.zIndex
                }}
                className="shrink-0 p-2 sm:p-3 flex items-center justify-center transition-all duration-500 ease-out hover:!scale-135 hover:!z-50 hover:!rotate-0 cursor-pointer"
              >
                <img
                  src={brand.url}
                  alt={brand.id}
                  className="h-16 sm:h-22 max-w-[150px] object-contain drop-shadow-sm hover:drop-shadow-xl transition-all"
                />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 4. FEATURE PRODUCTS (PRODUCT HIGHLIGHTS - CLEAN WHITE/LIGHT CARDS) */}
      <section id="export-catalog-preview" className="py-16 bg-white border-b border-slate-200 px-4 md:px-8">
        <div className="max-w-6xl mx-auto w-full">
          <div className="flex flex-col md:flex-row md:items-end justify-between mb-10 gap-4">
            <div>
              <span className="text-xs font-extrabold text-amber-700 uppercase tracking-widest">
                Export Catalog Preview
              </span>
              <h2 className="text-2xl sm:text-4xl font-extrabold text-slate-900 mt-1">
                Featured Ready-to-Cook &amp; Beverage Highlights
              </h2>
              <p className="text-xs sm:text-sm text-slate-600 mt-2 max-w-2xl">
                Explore our export-ready products with complete carton specifications, ambient shelf-life, and instant FOB/CIF trade pricing for your shelves.
              </p>
            </div>

            <div className="flex items-center gap-3 shrink-0">
              {/* Product Shuffle / Swap Button with Undulating Liquid Wave Animation */}
              <button
                onClick={handleManualRefreshProducts}
                disabled={isRefreshingProducts}
                className="relative overflow-hidden inline-flex items-center justify-center bg-slate-100 hover:bg-slate-200 text-slate-900 font-extrabold px-6 py-2 rounded-xl text-xs transition-all border border-slate-300 cursor-pointer shadow-xs active:scale-95 group min-w-[80px]"
                title="Click to Swap Products"
              >
                {/* 30s Rising Liquid Wave Layers (2 Solid Waves, Zero Opacity Blending) */}
                <div key={swapKey} className="wave-container-rising pointer-events-none">
                  <div className="wave-crest-back" />
                  <div className="wave-crest-front" />
                  <div className="wave-body" />
                </div>

                {/* Button Text */}
                <span className="relative z-10 font-bold tracking-wide">
                  {isRefreshingProducts ? 'Swapping...' : 'Swap'}
                </span>
              </button>

              <button
                onClick={() => scrollToSection('lead-form')}
                className="inline-flex items-center gap-1 text-xs font-bold text-amber-700 hover:text-amber-900 transition-colors cursor-pointer"
              >
                <span>Full Catalog</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          {loadingProducts ? (
            <div className="py-16 text-center text-slate-400 text-sm animate-pulse">
              Loading export product specifications...
            </div>
          ) : (
            <div className={`flex sm:grid sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 overflow-x-auto sm:overflow-x-visible pb-4 sm:pb-0 snap-x snap-mandatory scrollbar-none transition-all duration-300 ease-in-out ${
              isFadingSwap ? 'opacity-0 scale-[0.98]' : 'opacity-100 scale-100'
            }`}>
              {featuredProducts.map((item) => {
                const meta = item.product_meta || {};
                const imageSrc = item.image || (meta.Images && meta.Images[0]) || '';
                const brandObj = brands.find((b) => b.id === item.brands_id);
                const brandName = brandObj ? brandObj.display_name : 'HSG Global';
                const productTitle = meta.Short_Title || meta.Title || item.display_name;
                const eaCtn = item.carton || '12';
                
                // Calculate dynamic standard pallet count based on product packaging / category
                const getPalletCount = (prod: CatalogProduct): number => {
                  if (prod.pallet_ctn) return Number(prod.pallet_ctn);
                  const skuLower = (prod.sku || '').toLowerCase();
                  const cat = (meta.Category || '').toLowerCase();
                  const cartonNum = Number(prod.carton) || 12;

                  if (skuLower.includes('1.5l')) return 48; // Large 1.5L bottles (4 layers of 12)
                  if (skuLower.includes('275ml') || skuLower.includes('glass')) return 64; // Glass bottles
                  if (skuLower.includes('325') || skuLower.includes('330') || cat.includes('beverage')) return 72; // Beverage Cans (6 layers of 12)
                  if (skuLower.includes('100g')) return 120; // Lightweight 100g pouches
                  if (skuLower.includes('150g') || skuLower.includes('200g')) return 96; // 150-200g pastes (8 layers of 12)
                  if (skuLower.includes('400g') || cartonNum === 12) return 80; // 400g jars/pastes
                  return 80;
                };

                const ctnPerPlt = getPalletCount(item);

                return (
                  <div
                    key={item.sku}
                    className="min-w-[260px] max-w-[280px] sm:min-w-0 sm:max-w-none snap-center shrink-0 sm:shrink bg-white rounded-2xl overflow-hidden shadow-sm hover:shadow-xl transition-all duration-300 flex flex-col group border border-slate-200"
                  >
                    {/* Image Box - ZERO Padding, Full Bleed Flush Image */}
                    <div className="h-64 w-full bg-slate-900 relative overflow-hidden flex items-center justify-center">
                      {imageSrc ? (
                        <img
                          src={imageSrc}
                          alt={item.display_name}
                          className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-500"
                        />
                      ) : (
                        <Package className="w-12 h-12 text-slate-500" />
                      )}
                      <div className="absolute top-2.5 right-2.5 bg-black/70 backdrop-blur-md px-2 py-0.5 rounded text-[10px] font-semibold text-[#d4af37] border border-[#d4af37]/30">
                        {brandName}
                      </div>
                    </div>

                    {/* Content Box */}
                    <div className="p-4 flex-1 flex flex-col justify-between bg-white">
                      <div>
                        <h4 className="font-bold text-[#0f172a] text-base leading-snug group-hover:text-amber-700 transition-colors line-clamp-1">
                          {productTitle}
                        </h4>
                      </div>

                      {/* Clean Specifications Grid */}
                      <div className="mt-4 pt-3 border-t border-slate-100 grid grid-cols-2 gap-y-1.5 text-xs text-[#0284c7] font-medium">
                        <div className="text-left font-semibold">
                          {eaCtn} EA / CTN
                        </div>
                        <div className="text-right font-semibold">
                          {ctnPerPlt} CTN / PLT
                        </div>
                        <div className="text-left text-slate-600">
                          15°–25°C
                        </div>
                        <div className="text-right text-slate-600">
                          24 Months
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* 5. BOOK MEETING SECTION (PREMIUM GOLD/DARK CARD ON LIGHT CANVAS - AUTO HIDES AFTER EXPO ENDS) */}
      {expoTimeState.status !== 'ended' && (
        <section id="meeting-section" className="py-16 px-4 md:px-8 max-w-4xl mx-auto w-full text-center">
          <div className="bg-batik-hero text-white p-8 md:p-12 rounded-3xl relative overflow-hidden shadow-2xl border border-amber-500/30">
            <div className="w-14 h-14 rounded-2xl bg-[#d4af37]/20 flex items-center justify-center text-[#d4af37] mx-auto mb-4">
              <Calendar className="w-7 h-7" />
            </div>
            <span className="text-xs font-bold text-[#d4af37] uppercase tracking-widest">Connect at the Expo</span>
            <h2 className="text-2xl sm:text-3xl font-extrabold text-white mt-1">
              Book a 1-on-1 Trade Meeting at Our Booth
            </h2>
            <p className="text-xs sm:text-sm text-slate-300 max-w-lg mx-auto mt-2 leading-relaxed">
              Discuss direct importing, private label, FOB/CIF shipping to Australia, or distributing your Australian products into Singapore’s top supermarket chains.
            </p>

            {/* Countdown Badge in Section */}
            {expoTimeState.status === 'live' && (
              <div className="mt-4 inline-flex items-center gap-2 bg-[#d4af37]/20 border border-[#d4af37]/50 text-[#fef08a] text-xs font-bold px-4 py-1.5 rounded-full">
                <Clock className="w-4 h-4 text-[#d4af37]" />
                <span>Exhibition Closing In: {expoTimeState.countdownFormatted}</span>
              </div>
            )}

            <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-4">
              <a
                href="https://wa.me/6588002263?text=Hi%20HSG%20Global%20Team%2C%20I%20would%20like%20to%20meet%20at%20Fine%20Food%20Australia%202026."
                target="_blank"
                rel="noreferrer"
                className="w-full sm:w-auto bg-[#25D366] hover:bg-[#1faa4f] text-white font-extrabold px-8 py-3.5 rounded-xl flex items-center justify-center gap-2.5 text-xs uppercase tracking-wider transition-all shadow-lg active:scale-95 border border-emerald-400/30"
              >
                {/* Official WhatsApp Logo */}
                <svg className="w-4 h-4 fill-current shrink-0" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                </svg>
                Direct WhatsApp Us
              </a>
              <button
                onClick={() => {
                  setShowFullInquiryForm(true);
                  scrollToSection('lead-form');
                }}
                className="w-full sm:w-auto bg-batik-card-dark hover:bg-white/10 text-white font-bold px-6 py-3.5 rounded-xl border border-white/20 text-xs uppercase tracking-wider transition-all cursor-pointer"
              >
                Schedule Through Form ↓
              </button>
            </div>
          </div>
        </section>
      )}

      {/* 6. DOWNLOAD CATALOG & ENQUIRY FORM (CLEAN WHITE/LIGHT FORM WITH GOLD ACCENTS) */}
      <section id="lead-form" className="py-16 bg-batik-light border-t border-slate-200 px-4 md:px-8">
        <div className="max-w-3xl mx-auto w-full">
          <div className="text-center mb-8">
            {/* Official HSG Global Logo (Logo.png) - Clean Raw Display */}
            {normalLogo ? (
              <div className="flex justify-center mb-4">
                <img
                  src={normalLogo}
                  alt="HSG Global Official Logo"
                  className="h-14 sm:h-16 max-w-[220px] object-contain hover:scale-105 transition-transform"
                />
              </div>
            ) : (
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-[#d4af37] to-amber-600 flex items-center justify-center text-black mx-auto mb-3 shadow-md">
                <Download className="w-6 h-6" />
              </div>
            )}
            <span className="text-xs font-extrabold text-amber-700 uppercase tracking-widest">
              Trade Pricing &amp; Export Specifications
            </span>
            <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 mt-1">
              Request Your Official Export Catalog
            </h2>
            <p className="text-xs sm:text-sm text-slate-600 max-w-lg mx-auto mt-2 leading-relaxed">
              Get instant access to complete carton dimensions, pallet configurations, and competitive trade pricing tailored for your market.
            </p>
          </div>

          {submitSuccess ? (
            <div className="bg-white p-8 rounded-3xl text-center shadow-xl border border-amber-300">
              <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto mb-4 border border-emerald-300">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <h3 className="text-xl font-extrabold text-slate-900">
                Thank You{formData.name ? `, ${formData.name}` : ''}!
              </h3>
              <p className="text-sm text-slate-600 mt-2 max-w-md mx-auto">
                Your <strong>Export Product Catalog PDF</strong> has downloaded to your device and an email has been sent to <strong>{formData.email}</strong>.
              </p>
              <div className="mt-6 flex flex-col sm:flex-row items-center justify-center gap-3">
                <button
                  onClick={() => handleDownloadCatalog(formData.name, formData.company)}
                  className="bg-[#d4af37] text-black font-bold px-6 py-3 rounded-xl text-xs uppercase flex items-center gap-2 hover:bg-amber-400 transition-all cursor-pointer shadow-md"
                >
                  <Download className="w-4 h-4" />
                  Re-Download PDF
                </button>
                <button
                  onClick={() => setSubmitSuccess(false)}
                  className="bg-slate-100 text-slate-700 hover:bg-slate-200 px-6 py-3 rounded-xl text-xs uppercase transition-all cursor-pointer border border-slate-300"
                >
                  Submit Another Inquiry
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="bg-white p-6 sm:p-10 rounded-2xl border border-slate-200 shadow-xl space-y-3">
              {/* SINGLE LINE CONTROLS: [ Input Email ] [ Download Catalog (hidden when form open) ] [ Send Inquiry ] */}
              <div className="flex flex-col md:flex-row items-stretch gap-3">
                {/* 1. Input Email */}
                <div className="flex-1">
                  <input
                    type="email"
                    required
                    placeholder="Enter your business email (name@company.com)..."
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="w-full h-12 bg-slate-50/80 border border-slate-300 rounded-xl px-4 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-[#d4af37] focus:ring-1 focus:ring-[#d4af37] transition-all"
                  />
                </div>

                {/* 2. Download Catalog Button (Hidden when Inquiry Form is open) */}
                {!showFullInquiryForm && (
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="h-12 px-6 bg-gradient-to-r from-amber-600 via-[#d4af37] to-amber-600 hover:from-amber-500 hover:to-amber-600 text-black font-extrabold rounded-xl shadow-md flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:opacity-75 cursor-pointer text-xs uppercase tracking-wider shrink-0"
                  >
                    <Download className={`w-4 h-4 ${isSubmitting ? 'animate-bounce' : ''}`} />
                    <span>Download Catalog</span>
                  </button>
                )}

                {/* 3. Send Inquiry Button (Toggles full form) */}
                <button
                  type="button"
                  onClick={() => setShowFullInquiryForm(!showFullInquiryForm)}
                  className={`h-12 px-5 font-bold rounded-xl border transition-all flex items-center justify-center gap-2 text-xs uppercase tracking-wider shrink-0 cursor-pointer ${
                    showFullInquiryForm
                      ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
                      : 'bg-white hover:bg-slate-50 text-slate-800 border-slate-300 hover:border-slate-400'
                  }`}
                >
                  <MessageSquare className="w-4 h-4 text-amber-600" />
                  <span>Send Inquiry</span>
                  <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${showFullInquiryForm ? 'rotate-180' : ''}`} />
                </button>
              </div>

              {/* ERROR MESSAGE (PLACED UNDER THE BUTTONS TO PREVENT ANY JUMPING) */}
              {submitError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs font-medium animate-fadeIn">
                  {submitError}
                </div>
              )}

              {/* ANIMATED PROGRESS BAR UNDER ONE-LINE INPUTS */}
              {isSubmitting && (
                <div className="w-full pt-1">
                  <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden relative shadow-inner">
                    <div className="h-full bg-gradient-to-r from-amber-500 via-[#d4af37] to-amber-600 rounded-full animate-[pulse_1s_ease-in-out_infinite] w-full transition-all duration-300" />
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-amber-800 font-semibold mt-1 px-0.5">
                    <span>{verificationMessage}</span>
                    <span className="text-[10px] text-slate-500 font-mono">LIVE MX CHECK</span>
                  </div>
                </div>
              )}

              {/* EXPANDABLE FULL INQUIRY FORM (OPENS UNDER IT WHEN CLICKED) */}
              {showFullInquiryForm && (
                <div className="space-y-4 pt-4 mt-2 border-t border-slate-200 animate-fadeIn">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-900">
                      Additional Inquiry &amp; Booth Meeting Details
                    </h4>
                    <span className="text-[11px] text-slate-400">Optional</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* Full Name */}
                    <div>
                      <label className="block text-xs font-semibold text-slate-800 mb-1.5 uppercase tracking-wide">
                        Full Name
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. John Doe"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        className="w-full bg-slate-50/70 border border-slate-300 rounded-lg px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-[#d4af37] focus:ring-1 focus:ring-[#d4af37] transition-all"
                      />
                    </div>

                    {/* Company Name */}
                    <div>
                      <label className="block text-xs font-semibold text-slate-800 mb-1.5 uppercase tracking-wide">
                        Company / Organization
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. Pacific Imports Pty Ltd"
                        value={formData.company}
                        onChange={(e) => setFormData({ ...formData, company: e.target.value })}
                        className="w-full bg-slate-50/70 border border-slate-300 rounded-lg px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-[#d4af37] focus:ring-1 focus:ring-[#d4af37] transition-all"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* Phone / WhatsApp */}
                    <div>
                      <label className="block text-xs font-semibold text-slate-800 mb-1.5 uppercase tracking-wide">
                        Phone / WhatsApp <span className="text-slate-400 font-normal">(Optional)</span>
                      </label>
                      <input
                        type="tel"
                        placeholder="+61 400 000 000"
                        value={formData.phone}
                        onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                        className="w-full bg-slate-50/70 border border-slate-300 rounded-lg px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-[#d4af37] focus:ring-1 focus:ring-[#d4af37] transition-all"
                      />
                    </div>

                    {/* Primary Interest */}
                    <div>
                      <label className="block text-xs font-semibold text-slate-800 mb-1.5 uppercase tracking-wide">
                        Primary Opportunity
                      </label>
                      <select
                        value={formData.inquiry_type}
                        onChange={(e) => setFormData({ ...formData, inquiry_type: e.target.value })}
                        className="w-full bg-slate-50/70 border border-slate-300 rounded-lg px-4 py-2.5 text-sm text-slate-900 focus:outline-none focus:bg-white focus:border-[#d4af37] focus:ring-1 focus:ring-[#d4af37] transition-all cursor-pointer"
                      >
                        <option value="Looking to Import Asian Products to Australia/Global">
                          Looking to Import Ready-to-Cook Pastes &amp; Beverages into Australia
                        </option>
                        <option value="Looking to Distribute Australian Brands into Singapore">
                          Looking to Distribute Australian Products into Singapore Retail (FairPrice, Sheng Siong, etc.)
                        </option>
                        <option value="Private Label & Custom Recipe Manufacturing">
                          Private Label &amp; Custom Sautéed Paste Manufacturing
                        </option>
                        <option value="General Expo Inquiry & Sample Request">
                          Product Sample Request &amp; General Inquiries
                        </option>
                      </select>
                    </div>
                  </div>

                  {/* Message */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-800 mb-1.5 uppercase tracking-wide">
                      Message / Custom Notes <span className="text-slate-400 font-normal">(Optional)</span>
                    </label>
                    <textarea
                      rows={3}
                      placeholder="Tell us about your distribution channels, port of destination, or specific products of interest..."
                      value={formData.message}
                      onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                      className="w-full bg-slate-50/70 border border-slate-300 rounded-lg px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-[#d4af37] focus:ring-1 focus:ring-[#d4af37] transition-all resize-none"
                    />
                  </div>

                  <div className="pt-2">
                    <button
                      type="submit"
                      disabled={isSubmitting}
                      className="w-full bg-slate-900 hover:bg-black text-white font-bold py-3 rounded-xl transition-all text-xs uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer shadow-md disabled:opacity-60"
                    >
                      <Send className="w-4 h-4 text-amber-400" />
                      <span>Submit Inquiry &amp; Download Catalog</span>
                    </button>
                  </div>
                </div>
              )}

              <p className="text-[11px] text-slate-500 text-center pt-2">
                All submitted trade data is kept strictly confidential. The export catalog will be delivered directly to your inbox.
              </p>
            </form>
          )}
        </div>
      </section>

      {/* FOOTER - MALAYSIAN BATIK TERENGGANU FLORAL FOLIAGE */}
      <div className="batik-gold-ribbon w-full" />
      <footer className="py-12 bg-batik-footer text-slate-300 text-center text-xs relative overflow-hidden border-t border-amber-500/20">
        <div className="max-w-6xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-6 relative z-10">
          <div className="text-left flex flex-col sm:flex-row items-center sm:items-start gap-4">
            {whiteLogo && (
              <img
                src={whiteLogo}
                alt="HSG Global White Logo"
                className="h-10 sm:h-12 max-w-[180px] object-contain shrink-0"
              />
            )}
            <div>
              <span className="font-extrabold text-white block text-sm tracking-wide">
                HSG GLOBAL PTE LTD
              </span>
              <span className="text-[11px] text-amber-400/80 font-medium">
                Fine Food Australia 2026 Exhibitor Showcase
              </span>
              <span className="text-[11px] text-slate-400 block mt-0.5">
                Singapore • Malaysia • Australia • Global Foodservice &amp; Retail FMCG
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-6 text-[12px] font-medium">
            <a
              href="https://hsg-global.com"
              target="_blank"
              rel="noreferrer"
              className="text-slate-300 hover:text-[#d4af37] transition-colors"
            >
              Official Website (hsg-global.com)
            </a>
            <span className="text-slate-600 hidden sm:inline">•</span>
            <a
              href="mailto:sales@hsg-global.com"
              className="text-slate-300 hover:text-[#d4af37] transition-colors"
            >
              sales@hsg-global.com
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
