import * as pdfjsLib from 'pdfjs-dist';
import { jsPDF } from 'jspdf';
import { PageData } from '../types';

// Configure worker to match the version in importmap (4.4.168)
// We use cdnjs for the worker as it is reliable for this specific file.
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs`;

export const getPdfPageCount = async (file: File): Promise<number> => {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  return pdf.numPages;
};

export const convertPdfToImages = async (file: File, startPage?: number, endPage?: number): Promise<string[]> => {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const numPages = pdf.numPages;
  const images: string[] = [];

  // Determine range
  const start = startPage ? Math.max(1, startPage) : 1;
  const end = endPage ? Math.min(numPages, endPage) : numPages;

  for (let i = start; i <= end; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 2.0 }); // Scale up for better quality
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');

    if (!context) {
      throw new Error('Canvas context not available');
    }

    canvas.height = viewport.height;
    canvas.width = viewport.width;

    // Cast to any to avoid type error: Property 'canvas' is missing in type ... but required in type 'RenderParameters'.
    // This is likely a type definition issue in the used version of pdfjs-dist.
    await page.render({
      canvasContext: context,
      viewport: viewport,
    } as any).promise;

    images.push(canvas.toDataURL('image/jpeg', 0.95));
  }

  return images;
};

export const convertFileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

// Helper to compress image to JPEG before adding to PDF to save space
const compressImageToJpeg = (base64: string, quality = 0.85): Promise<string> => {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                resolve(base64); // Fallback
                return;
            }
            // Fill white background for transparent images
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0);
            resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.onerror = (e) => {
             console.warn("Image compression failed, using original", e);
             resolve(base64);
        };
        img.src = base64;
    });
};

export const generatePdfFromImages = async (images: string[]): Promise<Blob> => {
  if (images.length === 0) {
    throw new Error("No images to generate PDF");
  }

  // Calculate dimensions based on the first image (assuming consistent size or fitting to A4)
  const pdf = new jsPDF({
    orientation: 'p',
    unit: 'mm',
    format: 'a4',
  });

  const pdfWidth = pdf.internal.pageSize.getWidth();
  const pdfHeight = pdf.internal.pageSize.getHeight();

  for (let index = 0; index < images.length; index++) {
    const rawImgData = images[index];
    
    // Compress image to JPEG to reduce PDF file size
    const imgData = await compressImageToJpeg(rawImgData);

    if (index > 0) {
      pdf.addPage();
    }

    const imgProps = pdf.getImageProperties(imgData);
    const imgRatio = imgProps.width / imgProps.height;
    const pdfRatio = pdfWidth / pdfHeight;

    let finalWidth = pdfWidth;
    let finalHeight = pdfHeight;

    // Logic to fit image within page bounds while maintaining aspect ratio
    if (imgRatio > pdfRatio) {
      // Image is wider than page relative to height
      finalHeight = pdfWidth / imgRatio;
    } else {
      // Image is taller than page relative to width
      finalWidth = pdfHeight * imgRatio;
    }

    const x = (pdfWidth - finalWidth) / 2;
    const y = (pdfHeight - finalHeight) / 2;

    pdf.addImage(imgData, 'JPEG', x, y, finalWidth, finalHeight);
  }

  return pdf.output('blob');
};

export const generateComparisonPdf = async (pages: { original: string, translated: string }[]): Promise<Blob> => {
  if (pages.length === 0) {
    throw new Error("No pages to generate PDF");
  }

  // Create Landscape A4 PDF for side-by-side comparison
  const pdf = new jsPDF({
    orientation: 'l',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = pdf.internal.pageSize.getWidth(); // ~297mm
  const pageHeight = pdf.internal.pageSize.getHeight(); // ~210mm
  const margin = 10;
  const gap = 5;
  
  // Calculate area for each image (half the page width minus margins)
  const contentWidth = pageWidth - (2 * margin);
  const halfWidth = (contentWidth - gap) / 2;
  const maxHeight = pageHeight - (2 * margin);

  for (let index = 0; index < pages.length; index++) {
    const pageData = pages[index];

    // Compress images to JPEG to reduce PDF file size
    const originalCompressed = await compressImageToJpeg(pageData.original);
    const translatedCompressed = await compressImageToJpeg(pageData.translated);

    if (index > 0) {
      pdf.addPage();
    }

    // Helper to draw image fitted in a specific box
    const drawImageInBox = (imgData: string, xBase: number, yBase: number, boxW: number, boxH: number) => {
        const imgProps = pdf.getImageProperties(imgData);
        const imgRatio = imgProps.width / imgProps.height;
        const boxRatio = boxW / boxH;

        let finalW = boxW;
        let finalH = boxH;

        if (imgRatio > boxRatio) {
            // Limited by width (image is "flatter" than the box)
            finalH = boxW / imgRatio;
        } else {
            // Limited by height (image is "taller" than the box)
            finalW = boxH * imgRatio;
        }
        
        // Center image in the box
        const x = xBase + (boxW - finalW) / 2;
        const y = yBase + (boxH - finalH) / 2;
        
        pdf.addImage(imgData, 'JPEG', x, y, finalW, finalH);
    };

    // Draw Original Image on Left
    drawImageInBox(originalCompressed, margin, margin, halfWidth, maxHeight);
    
    // Draw Translated Image on Right
    drawImageInBox(translatedCompressed, margin + halfWidth + gap, margin, halfWidth, maxHeight);
    
    // Optional: Add small labels at the bottom if needed
    pdf.setFontSize(8);
    pdf.setTextColor(100);
    pdf.text("Original", margin, pageHeight - 5);
    pdf.text("Translated", margin + halfWidth + gap, pageHeight - 5);
  }

  return pdf.output('blob');
};

// --- Evaluation Report PDF Generation ---

// Utility to wrap text on Canvas
const wrapText = (ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number) => {
    // Basic character-based wrapping which works reasonably well for both English and CJK
    let line = '';
    let currentY = y;

    for (let n = 0; n < text.length; n++) {
        const testLine = line + text[n];
        const metrics = ctx.measureText(testLine);
        const testWidth = metrics.width;
        
        // If width exceeds max, print current line and start new one
        if (testWidth > maxWidth && n > 0) {
            ctx.fillText(line, x, currentY);
            line = text[n];
            currentY += lineHeight;
        } else {
            line = testLine;
        }
    }
    // Print last line
    ctx.fillText(line, x, currentY);
    return currentY + lineHeight;
};

// Render a single evaluation report page to a high-res canvas image
const createReportPageImage = async (page: PageData): Promise<string> => {
    const canvas = document.createElement('canvas');
    // A4 Portrait size at roughly 150 DPI (1240 x 1754 px)
    const width = 1240;
    const height = 1754;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error("Canvas context missing");

    // 1. Background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    // 2. Header
    ctx.fillStyle = '#1e293b'; // slate-800
    ctx.font = 'bold 36px sans-serif';
    ctx.fillText(`Evaluation Report - Page ${page.pageNumber}`, 50, 60);

    // Score Badge in Header
    if (page.evaluation) {
        const score = page.evaluation.averageScore;
        // Color coding
        ctx.fillStyle = score >= 8 ? '#16a34a' : score >= 5 ? '#ca8a04' : '#dc2626';
        ctx.font = 'bold 28px sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(`Score: ${score}/10`, width - 50, 60);
        ctx.textAlign = 'left';
    }

    // 3. Comparison Images (Top Half)
    const imgAreaY = 100;
    const imgAreaH = 600;
    const margin = 50;
    const gap = 20;
    const halfW = (width - (margin * 2) - gap) / 2;

    const drawImg = async (src: string, x: number) => {
        return new Promise<void>((resolve) => {
            const img = new Image();
            img.onload = () => {
                // Fit image in the designated box while preserving aspect ratio
                const ratio = img.width / img.height;
                const boxRatio = halfW / imgAreaH;
                let dw = halfW;
                let dh = imgAreaH;
                if (ratio > boxRatio) {
                    dh = halfW / ratio;
                } else {
                    dw = imgAreaH * ratio;
                }
                // Center in box
                const dx = x + (halfW - dw) / 2;
                const dy = imgAreaY + (imgAreaH - dh) / 2;
                ctx.drawImage(img, dx, dy, dw, dh);
                resolve();
            };
            img.onerror = () => resolve(); // prevent crash on image fail
            img.src = src;
        });
    };

    // Draw images
    await drawImg(page.originalImage, margin);
    if (page.translatedImage) {
        await drawImg(page.translatedImage, margin + halfW + gap);
    }

    // Image Labels
    ctx.font = '16px sans-serif';
    ctx.fillStyle = '#64748b'; // slate-500
    ctx.textAlign = 'center';
    ctx.fillText("Original", margin + halfW / 2, imgAreaY + imgAreaH + 25);
    ctx.fillText("Translated", margin + halfW + gap + halfW / 2, imgAreaY + imgAreaH + 25);
    ctx.textAlign = 'left';

    // 4. Scores & Feedback (Bottom Half)
    let currentY = imgAreaY + imgAreaH + 80;
    
    // Title
    ctx.fillStyle = '#0f172a'; // slate-900
    ctx.font = 'bold 24px sans-serif';
    ctx.fillText("Detailed Scores", margin, currentY);
    currentY += 40;

    if (page.evaluation) {
        const scores = page.evaluation.scores;
        // Explicit order of keys
        const keys: (keyof typeof scores)[] = ['accuracy', 'fluency', 'consistency', 'terminology', 'completeness', 'formatPreservation'];
        
        // Draw 2-column grid of scores
        const colW = (width - margin * 2) / 2;
        
        keys.forEach((key, idx) => {
            const val = scores[key];
            const x = margin + (idx % 2) * colW;
            const row = Math.floor(idx / 2);
            const y = currentY + row * 40;
            
            // Label
            ctx.fillStyle = '#475569';
            ctx.font = '20px sans-serif';
            const label = key.charAt(0).toUpperCase() + key.slice(1).replace(/([A-Z])/g, ' $1');
            ctx.fillText(`${label}: ${val}`, x, y);
            
            // Bar Background
            const barX = x + 250;
            const barY = y - 16;
            const barW = 200;
            const barH = 12;
            
            ctx.fillStyle = '#e2e8f0';
            ctx.fillRect(barX, barY, barW, barH);
            
            // Bar Fill
            ctx.fillStyle = val >= 8 ? '#16a34a' : val >= 5 ? '#eab308' : '#ef4444';
            ctx.fillRect(barX, barY, barW * (val / 10), barH);
        });

        currentY += Math.ceil(keys.length / 2) * 40 + 30;

        // Reason Section
        ctx.fillStyle = '#0f172a';
        ctx.font = 'bold 24px sans-serif';
        ctx.fillText("评估原因 (Reason)", margin, currentY);
        currentY += 35;
        
        ctx.fillStyle = '#334155';
        ctx.font = '20px sans-serif';
        currentY = wrapText(ctx, page.evaluation.reason, margin, currentY, width - margin * 2, 30);
        currentY += 40;

        // Suggestions Section
        ctx.fillStyle = '#0f172a';
        ctx.font = 'bold 24px sans-serif';
        ctx.fillText("优化建议 (Suggestions)", margin, currentY);
        currentY += 35;
        
        ctx.fillStyle = '#4338ca'; // indigo-700
        ctx.font = '20px sans-serif';
        wrapText(ctx, page.evaluation.suggestions, margin, currentY, width - margin * 2, 30);
    }

    return canvas.toDataURL('image/jpeg', 0.85);
};

export const generateEvaluationPdf = async (pages: PageData[]): Promise<Blob> => {
  if (pages.length === 0) {
    throw new Error("No evaluated pages to generate report");
  }

  const pdf = new jsPDF({
    orientation: 'p',
    unit: 'mm',
    format: 'a4',
  });

  const pdfWidth = pdf.internal.pageSize.getWidth();
  const pdfHeight = pdf.internal.pageSize.getHeight();

  for (let i = 0; i < pages.length; i++) {
      if (i > 0) pdf.addPage();
      
      // Render the visual report to an image string first
      const reportImage = await createReportPageImage(pages[i]);
      
      // Add that image to the PDF filling the page
      pdf.addImage(reportImage, 'JPEG', 0, 0, pdfWidth, pdfHeight);
  }

  return pdf.output('blob');
};