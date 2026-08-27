import jsPDF from "jspdf";
import autoTable, { applyPlugin } from "jspdf-autotable";

// Ensure autoTable plugin is registered on jsPDF instance
try {
  applyPlugin(jsPDF);
} catch (e) {
  // Ignored if already applied
}

export interface CatalogProduct {
  sku: string;
  display_name: string;
  image?: string;
  thumbnail?: string;
  carton?: string;
  pallet_ctn?: string | number;
  storage_condition?: string;
  shelf_life?: string;
  single_barcode?: string;
  carton_barcode?: string;
  carton_weight?: string;
  carton_h_mm?: number | null;
  carton_w_mm?: number | null;
  carton_l_mm?: number | null;
  product_meta?: {
    Title?: string;
    Short_Title?: string;
    Category?: string;
    Short_Des?: string;
    Long_Des?: string;
    Images?: string[];
  };
  brands_id?: string;
  [key: string]: any;
}

export interface BrandInfo {
  id: string;
  display_name: string;
  description?: string;
  [key: string]: any;
}

// Preload and convert an image URL to a clean compressed data URL (capped at 300px for high-speed PDF rendering)
async function loadImageAsDataUrl(url: string, isLogo = false): Promise<string | null> {
  if (!url) return null;
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 3500); // 3.5s fail-safe timeout
    const img = new Image();
    img.crossOrigin = "Anonymous";
    img.onload = () => {
      clearTimeout(timer);
      try {
        const canvas = document.createElement("canvas");
        const maxDim = isLogo ? 320 : 260; // Lightweight max thumbnail size
        let w = img.naturalWidth || maxDim;
        let h = img.naturalHeight || maxDim;

        if (w > maxDim || h > maxDim) {
          if (w > h) {
            h = Math.round((h * maxDim) / w);
            w = maxDim;
          } else {
            w = Math.round((w * maxDim) / h);
            h = maxDim;
          }
        }

        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          if (!isLogo) {
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, w, h);
          }
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL(isLogo ? "image/png" : "image/jpeg", 0.85));
        } else {
          resolve(null);
        }
      } catch (err) {
        resolve(null);
      }
    };
    img.onerror = () => {
      clearTimeout(timer);
      resolve(null);
    };
    img.src = url;
  });
}

export interface PdfCustomOptions {
  headerTitle?: string;
  subtext?: string;
  footerText?: string;
}

export async function generateExportCatalogPdf(
  products: CatalogProduct[],
  brands: BrandInfo[],
  prospectName?: string,
  companyName?: string,
  catalogHash?: string,
  customOptions?: PdfCustomOptions
) {
  const doc = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4"
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const brandMap = new Map(brands.map((b) => [b.id, b]));

  // 1. Group products by Brand
  const brandGroups: { [brandId: string]: CatalogProduct[] } = {};

  products.forEach((prod) => {
    const bId = prod.brands_id || "BRAND_OTHER";
    if (!brandGroups[bId]) brandGroups[bId] = [];
    brandGroups[bId].push(prod);
  });

  // Sort brands by Rank or Name, and sort products inside each brand alphabetically
  const sortedBrandIds = Object.keys(brandGroups).sort((a, b) => {
    const brandA = brandMap.get(a);
    const brandB = brandMap.get(b);
    const rankA = Number(brandA?.rank || 999);
    const rankB = Number(brandB?.rank || 999);
    if (rankA !== rankB) return rankA - rankB;
    const nameA = (brandA?.display_name || a).toLowerCase();
    const nameB = (brandB?.display_name || b).toLowerCase();
    return nameA.localeCompare(nameB);
  });

  for (const bId of sortedBrandIds) {
    brandGroups[bId].sort((a, b) => {
      const nameA = (a.product_meta?.Short_Title || a.product_meta?.Title || a.display_name || a.sku).toLowerCase();
      const nameB = (b.product_meta?.Short_Title || b.product_meta?.Title || b.display_name || b.sku).toLowerCase();
      return nameA.localeCompare(nameB);
    });
  }

  // 2. Preload 1:1 image Data URLs for all products & Company Logo
  const productImagesMap: { [sku: string]: string | null } = {};
  let companyLogoBase64: string | null = null;

  await Promise.all([
    loadImageAsDataUrl("/assets/logo/Logo.png", true).then((res) => {
      companyLogoBase64 = res;
    }),
    ...products.map(async (prod) => {
      const meta = prod.product_meta || {};
      const imgUrl = prod.image || (meta.Images && meta.Images[0]) || "";
      if (imgUrl) {
        productImagesMap[prod.sku] = await loadImageAsDataUrl(imgUrl);
      }
    })
  ]);

  // 3. FRONT COVER / CLEAN WHITE PRINT HEADER
  // Header container
  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, pageWidth, 42, "F");

  // Top Accent Gold Line
  doc.setFillColor(180, 140, 45); // Deep Gold #b48c2d
  doc.rect(0, 0, pageWidth, 3, "F");

  // Company Logo (Rendered on top left with transparent alpha)
  let textStartX = 14;
  if (companyLogoBase64) {
    try {
      doc.addImage(companyLogoBase64, "PNG", 14, 8, 24, 24);
      textStartX = 42; // Shift title text right of logo
    } catch (e) {
      textStartX = 14;
    }
  }

  // Company Name
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(15, 23, 42); // Slate 900
  doc.text("HSG GLOBAL PTE LTD", textStartX, 15);

  // Subtitle / Expo Badge
  const headerTitle =
    customOptions?.headerTitle ||
    "FINE FOOD AUSTRALIA 2026 • OFFICIAL EXPORT PRODUCT CATALOG";
  doc.setFontSize(8.5);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(180, 140, 45); // Deep Gold
  doc.text(headerTitle, textStartX, 21);

  // Contact Info & Export Terms
  const subtext =
    customOptions?.subtext ||
    "Contact: sales@hsg-global.com | hsgglobal.sg\nSingapore • Malaysia • Australia • Global Foodservice & Retail FMCG | FOB / CIF Terms";
  doc.setFontSize(7.5);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(71, 85, 105); // Slate 600

  const subLines = doc.splitTextToSize(subtext, pageWidth - textStartX - 14);
  doc.text(subLines, textStartX, 26.5);

  // Divider line under header
  doc.setDrawColor(226, 232, 240); // Slate 200
  doc.setLineWidth(0.5);
  doc.line(14, 40, pageWidth - 14, 40);

  // 4. RENDER INDIVIDUAL BRAND BLOCKS & SEPARATE TABLES
  let currentY = 52; // Generous breathing space below header

  sortedBrandIds.forEach((bId) => {
    const brandProducts = brandGroups[bId];
    const brandObj = brandMap.get(bId);
    const brandTitle = (brandObj?.display_name || bId).toUpperCase();
    const brandDesc = brandObj?.description || "Authentic Southeast Asian heritage brand, export ready with global compliance.";

    // Check if we need a new page for the upcoming brand title + initial table rows
    if (currentY > pageHeight - 55) {
      doc.addPage();
      currentY = 20;
    }

    // --- BRAND SECTION HEADER (OUTSIDE TABLE) ---
    // Brand Name Title
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42); // Slate 900
    doc.text(brandTitle, 14, currentY);

    // Brand Description
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139); // Slate 500
    const descLines = doc.splitTextToSize(brandDesc, pageWidth - 28);
    doc.text(descLines, 14, currentY + 4.5);

    const descHeight = (descLines.length * 3.6);

    // Decorative slim gold underline
    doc.setFillColor(180, 140, 45); // Deep Gold
    doc.rect(14, currentY + 4.5 + descHeight + 1, 28, 0.8, "F");

    currentY += 4.5 + descHeight + 5;

    // --- BUILD TABLE ROWS FOR THIS BRAND ---
    const tableBody: any[] = [];
    const productDataMap: { [rowIndex: number]: {
      imgData: string | null;
      brandName: string;
      item: CatalogProduct;
      productTitle: string;
      category: string;
      desc: string;
      eaCtn: string;
      ctnPerPlt: string;
      weight: string;
      dimStr: string;
      storage: string;
      shelfLife: string;
    } } = {};

    brandProducts.forEach((item) => {
      const meta = item.product_meta || {};
      const imgData = productImagesMap[item.sku] || null;
      const rowIndex = tableBody.length;

      const productTitle = meta.Short_Title || meta.Title || item.display_name;
      const category = meta.Category || "Food & Beverage";
      const desc = meta.Long_Des || meta.Short_Des || item.display_name || "-";
      const eaCtn = item.carton || "12";

      // Dynamic Pallet Calculation
      let ctnPerPlt = item.pallet_ctn ? String(item.pallet_ctn) : "72";
      const skuLower = (item.sku || "").toLowerCase();
      if (!item.pallet_ctn) {
        if (skuLower.includes("1.5l")) ctnPerPlt = "48";
        else if (skuLower.includes("275ml") || skuLower.includes("glass")) ctnPerPlt = "64";
        else if (skuLower.includes("325") || skuLower.includes("330")) ctnPerPlt = "72";
        else if (skuLower.includes("400g") || skuLower.includes("200g")) ctnPerPlt = "96";
      }

      const weight = item.carton_weight ? `${item.carton_weight} kg` : "-";

      const dimParts: string[] = [];
      if (item.carton_l_mm) dimParts.push(`${(Number(item.carton_l_mm) / 10).toFixed(1).replace(/\.0$/, '')}`);
      if (item.carton_w_mm) dimParts.push(`${(Number(item.carton_w_mm) / 10).toFixed(1).replace(/\.0$/, '')}`);
      if (item.carton_h_mm) dimParts.push(`${(Number(item.carton_h_mm) / 10).toFixed(1).replace(/\.0$/, '')}`);
      const dimStr = dimParts.length > 0 ? `${dimParts.join(" × ")} cm` : "-";

      const storage = item.storage_condition || "Ambient (15°–25°C)";
      const shelfLife = item.shelf_life || "24 Months";

      productDataMap[rowIndex] = {
        imgData,
        brandName: brandTitle,
        item,
        productTitle,
        category,
        desc,
        eaCtn,
        ctnPerPlt,
        weight,
        dimStr,
        storage,
        shelfLife
      };

      // Push placeholder row (3 columns)
      tableBody.push([
        "", // Col 0: 1:1 Square Image
        "", // Col 1: Product Description (Title, Description, SKU/EAN, Category)
        ""  // Col 2: Packaging Details (2-Column Grid)
      ]);
    });

    // --- RENDER DEDICATED AUTOTABLE FOR THIS BRAND (3 COLUMNS: 24mm + 93mm + 65mm = 182mm total) ---
    const tableConfig: any = {
      startY: currentY,
      head: [[
        "Product Image",
        "Product Description",
        "Packaging Details"
      ]],
      body: tableBody,
      theme: "plain",
      pageBreak: "auto",
      rowPageBreak: "avoid", // SNAP: Never cut a row across page boundary
      headStyles: {
        fillColor: [241, 245, 249], // Slate 100
        textColor: [15, 23, 42],
        fontStyle: "bold",
        fontSize: 7.5,
        halign: "left",
        lineColor: [203, 213, 225],
        lineWidth: 0.3
      },
      bodyStyles: {
        textColor: [51, 65, 85],
        fontSize: 7,
        cellPadding: 2.5,
        minCellHeight: 28,
        valign: "top",
        lineColor: [226, 232, 240],
        lineWidth: 0.25
      },
      columnStyles: {
        0: { cellWidth: 24, minCellHeight: 28, halign: "center" }, // 1:1 Square Image
        1: { cellWidth: 93 }, // Product Details (Title + Description + SKU/EAN + Category)
        2: { cellWidth: 65 }  // Packaging Details 2-Column Grid (Generous width to prevent wrapping)
      },
      margin: { left: 14, right: 14, bottom: 20 },
      didDrawCell: (data: any) => {
        if (data.section !== "body") return;
        const pData = productDataMap[data.row.index];
        if (!pData) return;

        const cellX = data.cell.x;
        const cellY = data.cell.y;
        const cellW = data.cell.width;
        const cellH = data.cell.height;

        // --- COLUMN 0: 1:1 SQUARE IMAGE THUMBNAIL ---
        if (data.column.index === 0) {
          const imgSize = 20; // 20mm x 20mm (1:1 Ratio)
          const posX = cellX + (cellW - imgSize) / 2;
          const posY = cellY + (cellH - imgSize) / 2;

          // Background & border box
          doc.setFillColor(248, 250, 252);
          doc.rect(posX, posY, imgSize, imgSize, "F");
          doc.setDrawColor(226, 232, 240);
          doc.rect(posX, posY, imgSize, imgSize, "S");

          if (pData.imgData) {
            try {
              doc.addImage(pData.imgData, "PNG", posX, posY, imgSize, imgSize);
            } catch (e) {}
          }
        }

        // --- COLUMN 1: PRODUCT DETAILS (TITLE, DESCRIPTION, SKU/EAN, CATEGORY) ---
        if (data.column.index === 1) {
          let curY = cellY + 4;

          // 1. Product Title (Primary Bold, 8pt Slate 900)
          doc.setFont("helvetica", "bold");
          doc.setFontSize(8);
          doc.setTextColor(15, 23, 42); // Slate 900
          const titleLines = doc.splitTextToSize(pData.productTitle, cellW - 5);
          doc.text(titleLines, cellX + 2.5, curY);

          curY += (titleLines.length * 3.5) + 1;

          // 2. Product Description (Regular 6.8pt Slate 600)
          if (pData.desc && pData.desc !== "-") {
            doc.setFont("helvetica", "normal");
            doc.setFontSize(6.8);
            doc.setTextColor(71, 85, 105); // Slate 600
            const descLines = doc.splitTextToSize(pData.desc, cellW - 5);
            doc.text(descLines, cellX + 2.5, curY);
            curY += (descLines.length * 3.0) + 2;
          }

          // 3. SKU & Single EAN (Slate 500 on one line)
          doc.setFont("helvetica", "normal");
          doc.setFontSize(6.5);
          doc.setTextColor(100, 116, 139); // Slate 500
          const barcodePart = pData.item.single_barcode ? ` | EAN: ${pData.item.single_barcode}` : "";
          doc.text(`SKU: ${pData.item.sku}${barcodePart}`, cellX + 2.5, curY);

          curY += 3.2;

          // 4. Category Tag (Deep Gold)
          doc.setFont("helvetica", "bold");
          doc.setFontSize(6.5);
          doc.setTextColor(180, 140, 45); // Deep Gold
          doc.text(`Category: ${pData.category}`, cellX + 2.5, curY);
        }

        // --- COLUMN 2: 2-COLUMN PACKAGING & SPECIFICATIONS GRID ---
        if (data.column.index === 2) {
          const col1X = cellX + 3;
          const col2X = cellX + 33; // 33mm offset giving 32mm width to column 2
          let row1Y = cellY + 4;
          let row2Y = row1Y + 4;
          let row3Y = row2Y + 4;
          let row4Y = row3Y + 4;

          // Row 1: Ea/Ctn & Ctn/Plt
          doc.setFont("helvetica", "normal");
          doc.setFontSize(6.5);
          doc.setTextColor(51, 65, 85); // Slate 700
          doc.text(`Ea/Ctn: ${pData.eaCtn}`, col1X, row1Y);
          doc.text(`Ctn/Plt: ${pData.ctnPerPlt}`, col2X, row1Y);

          // Row 2: Weight & Ctn Dim (Safely within 32mm width, never touching right border)
          doc.text(`Weight: ${pData.weight}`, col1X, row2Y);
          doc.text(`Ctn Dim: ${pData.dimStr}`, col2X, row2Y);

          // Row 3: Store & Shelf
          doc.setTextColor(71, 85, 105);
          const shortStorage = pData.storage.replace(/Ambient\s*/i, '').trim() || '15°–25°C';
          const shortShelf = pData.shelfLife.replace(/Months/i, 'Mo').replace(/Month/i, 'Mo').trim() || '24 Mo';
          doc.text(`Store: ${shortStorage}`, col1X, row3Y);
          doc.text(`Shelf: ${shortShelf}`, col2X, row3Y);

          // Row 4 (Bottom): Ctn EAN
          if (pData.item.carton_barcode) {
            doc.setTextColor(100, 116, 139);
            doc.text(`Ctn EAN: ${pData.item.carton_barcode}`, col1X, row4Y);
          }
        }
      }
    };

    if (typeof (doc as any).autoTable === "function") {
      (doc as any).autoTable(tableConfig);
    } else if (typeof autoTable === "function") {
      autoTable(doc, tableConfig);
    }

    // Advance currentY to after this table + margin for the next brand block
    const lastTable = (doc as any).lastAutoTable;
    if (lastTable && lastTable.finalY) {
      currentY = lastTable.finalY + 12;
    } else {
      currentY += 60;
    }
  });

  // Global Footers on all pages
  const totalPages = doc.internal.pages.length - 1;
  const footerLabel =
    customOptions?.footerText ||
    "Fine Food Australia 2026 Official Export Catalog";

  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    const str = `Page ${i} of ${totalPages} | HSG Global Pte Ltd • ${footerLabel} • Inquiries: sales@hsg-global.com`;
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text(str, pageWidth / 2, pageHeight - 8, { align: "center" });

    // Subtle gold footer hairline (14mm margin matching table and header)
    doc.setFillColor(180, 140, 45);
    doc.rect(14, pageHeight - 12, pageWidth - 28, 0.3, "F");
  }

  // Save the PDF directly to client
  const filename = `HSG_Global_Official_Export_Catalog.pdf`;
  doc.save(filename);

  // Background async upload to Cloudflare R2 cache if catalogHash provided
  if (catalogHash) {
    try {
      const pdfBase64 = doc.output("datauristring").split(",")[1];
      fetch("https://ib-v2.hsgglobalpteltd.workers.dev/api/exhibitor/upload-catalog-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          catalog_hash: catalogHash,
          base64Data: pdfBase64
        })
      }).catch(() => {});
    } catch (e) {}
  }

  return doc;
}
