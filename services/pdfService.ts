
import * as pdfjsLib from 'pdfjs-dist';
import { jsPDF } from 'jspdf';
import { PageData } from '../types';

// Configure worker to match the version in importmap (4.4.168)
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

  const start = startPage ? Math.max(1, startPage) : 1;
  const end = endPage ? Math.min(numPages, endPage) : numPages;

  for (let i = start; i <= end; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 2.0 }); 
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');

    if (!context) {
      throw new Error('Canvas context not available');
    }

    canvas.height = viewport.height;
    canvas.width = viewport.width;

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

const compressImageToJpeg = (base64: string, quality = 0.85): Promise<string> => {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                resolve(base64);
                return;
            }
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0);
            resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.onerror = (e) => {
             console.warn("Compression failed", e);
             resolve(base64);
        };
        img.src = base64;
    });
};

export const generatePdfFromImages = async (images: string[]): Promise<Blob> => {
  if (images.length === 0) throw new Error("No images");
  const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
  const pdfWidth = pdf.internal.pageSize.getWidth();
  const pdfHeight = pdf.internal.pageSize.getHeight();

  for (let index = 0; index < images.length; index++) {
    const imgData = await compressImageToJpeg(images[index]);
    if (index > 0) pdf.addPage();
    const imgProps = pdf.getImageProperties(imgData);
    const imgRatio = imgProps.width / imgProps.height;
    const pdfRatio = pdfWidth / pdfHeight;
    let finalWidth = pdfWidth;
    let finalHeight = pdfHeight;
    if (imgRatio > pdfRatio) finalHeight = pdfWidth / imgRatio;
    else finalWidth = pdfHeight * imgRatio;
    const x = (pdfWidth - finalWidth) / 2;
    const y = (pdfHeight - finalHeight) / 2;
    pdf.addImage(imgData, 'JPEG', x, y, finalWidth, finalHeight);
  }
  return pdf.output('blob');
};

export const generateComparisonPdf = async (pages: { original: string, translated: string }[]): Promise<Blob> => {
  if (pages.length === 0) throw new Error("No pages");
  const pdf = new jsPDF({ orientation: 'l', unit: 'mm', format: 'a4' });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 10;
  const gap = 5;
  const halfWidth = (pageWidth - (2 * margin) - gap) / 2;
  const maxHeight = pageHeight - (2 * margin);

  for (let index = 0; index < pages.length; index++) {
    const pageData = pages[index];
    const originalCompressed = await compressImageToJpeg(pageData.original);
    const translatedCompressed = await compressImageToJpeg(pageData.translated);
    if (index > 0) pdf.addPage();

    const drawInBox = (imgData: string, xBase: number) => {
        const imgProps = pdf.getImageProperties(imgData);
        const imgRatio = imgProps.width / imgProps.height;
        const boxRatio = halfWidth / maxHeight;
        let finalW = halfWidth;
        let finalH = maxHeight;
        if (imgRatio > boxRatio) finalH = halfWidth / imgRatio;
        else finalW = maxHeight * imgRatio;
        const x = xBase + (halfWidth - finalW) / 2;
        const y = margin + (maxHeight - finalH) / 2;
        pdf.addImage(imgData, 'JPEG', x, y, finalW, finalH);
    };

    drawInBox(originalCompressed, margin);
    drawInBox(translatedCompressed, margin + halfWidth + gap);
    pdf.setFontSize(8);
    pdf.setTextColor(100);
    pdf.text("Original", margin, pageHeight - 5);
    pdf.text("Translated", margin + halfWidth + gap, pageHeight - 5);
  }
  return pdf.output('blob');
};

// --- Evaluation PDF Generation Updates ---

const wrapText = (ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number) => {
    let line = '';
    let currentY = y;
    for (let n = 0; n < text.length; n++) {
        const testLine = line + text[n];
        if (ctx.measureText(testLine).width > maxWidth && n > 0) {
            ctx.fillText(line, x, currentY);
            line = text[n];
            currentY += lineHeight;
        } else line = testLine;
    }
    ctx.fillText(line, x, currentY);
    return currentY + lineHeight;
};

const createSummaryPageImage = async (pages: PageData[]): Promise<string> => {
    const canvas = document.createElement('canvas');
    const width = 1240, height = 1754;
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, width, height);
    
    // Header
    ctx.textAlign = 'center'; ctx.font = 'bold 48px sans-serif'; ctx.fillStyle = '#1e293b';
    ctx.fillText("Translation Evaluation Report", width/2, 280);
    
    // Stats
    const totalTokens = pages.reduce((acc, p) => acc + (p.usage?.total.totalTokens || 0), 0);
    const validScores = pages.filter(p => p.evaluation).map(p => p.evaluation!.averageScore);
    const avg = validScores.length > 0 ? (validScores.reduce((a,b)=>a+b,0)/validScores.length).toFixed(2) : "N/A";

    // Table
    let currentY = 700;
    const dims = ['accuracy', 'fluency', 'consistency', 'terminology', 'completeness', 'spelling', 'trademarkProtection', 'redundancyRemoval'] as const;
    const labels = ['Accuracy', 'Fluency', 'Consistency', 'Terminology', 'Completeness', 'Spelling', 'Trademark Protection', 'Redundancy Removal'];
    
    const tableW = 900; const tableX = (width - tableW) / 2;
    ctx.fillStyle = '#f1f5f9'; ctx.fillRect(tableX, currentY, tableW, 60);
    ctx.textAlign = 'left'; ctx.fillStyle = '#475569'; ctx.font = 'bold 22px sans-serif';
    ctx.fillText("Metric", tableX + 40, currentY + 35);
    ctx.textAlign = 'right'; ctx.fillText("Avg Score", tableX + tableW - 40, currentY + 35);
    currentY += 60;

    dims.forEach((d, idx) => {
        const scores = pages.filter(p => p.evaluation).map(p => p.evaluation!.scores[d]);
        const scoreStr = scores.length > 0 ? (scores.reduce((a,b)=>a+b,0)/scores.length).toFixed(2) : "-";
        if (idx % 2 === 1) { ctx.fillStyle = '#f8fafc'; ctx.fillRect(tableX, currentY, tableW, 60); }
        ctx.textAlign = 'left'; ctx.fillStyle = '#334155'; ctx.font = '22px sans-serif';
        ctx.fillText(labels[idx], tableX + 40, currentY + 35);
        ctx.textAlign = 'right'; ctx.fillText(scoreStr, tableX + tableW - 40, currentY + 35);
        currentY += 60;
    });

    return canvas.toDataURL('image/jpeg', 0.90);
};

const createReportPageImage = async (page: PageData): Promise<string> => {
    const canvas = document.createElement('canvas');
    const width = 1240, height = 1754;
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, width, height);
    
    ctx.fillStyle = '#1e293b'; ctx.font = 'bold 36px sans-serif';
    ctx.fillText(`Evaluation Detail - Page ${page.pageNumber}`, 50, 60);
    
    if (page.evaluation) {
        ctx.textAlign = 'right'; ctx.fillText(`Score: ${page.evaluation.averageScore}/10`, width - 50, 60);
        ctx.textAlign = 'left';
        
        let curY = 800;
        const keys: (keyof typeof page.evaluation.scores)[] = ['accuracy', 'fluency', 'consistency', 'terminology', 'completeness', 'formatPreservation', 'spelling', 'trademarkProtection', 'redundancyRemoval'];
        keys.forEach((k, i) => {
            const v = page.evaluation!.scores[k];
            ctx.fillStyle = '#475569'; ctx.font = '18px sans-serif';
            ctx.fillText(`${k}: ${v}`, 50 + (i%2)*400, curY + Math.floor(i/2)*35);
        });
    }

    return canvas.toDataURL('image/jpeg', 0.85);
};

export const generateEvaluationPdf = async (pages: PageData[]): Promise<Blob> => {
  const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
  const pdfWidth = pdf.internal.pageSize.getWidth();
  const pdfHeight = pdf.internal.pageSize.getHeight();

  const summary = await createSummaryPageImage(pages);
  pdf.addImage(summary, 'JPEG', 0, 0, pdfWidth, pdfHeight);

  for (let i = 0; i < pages.length; i++) {
      pdf.addPage();
      const report = await createReportPageImage(pages[i]);
      pdf.addImage(report, 'JPEG', 0, 0, pdfWidth, pdfHeight);
  }
  return pdf.output('blob');
};
