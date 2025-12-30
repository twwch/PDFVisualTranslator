
import * as pdfjsLib from 'pdfjs-dist';
import { jsPDF } from 'jspdf';
import { PageData } from '../types';

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
    if (!context) throw new Error('Canvas context not available');
    canvas.height = viewport.height;
    canvas.width = viewport.width;
    await page.render({ canvasContext: context, viewport: viewport } as any).promise;
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
            if (!ctx) { resolve(base64); return; }
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0);
            resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.onerror = () => resolve(base64);
        img.src = base64;
    });
};

const loadImage = (src: string): Promise<HTMLImageElement> => {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("Image load failed"));
        img.src = src;
    });
};

const wrapText = (ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number) => {
    const words = text.split('');
    let line = '';
    let currentY = y;
    for (let n = 0; n < words.length; n++) {
        const testLine = line + words[n];
        const metrics = ctx.measureText(testLine);
        if (metrics.width > maxWidth && n > 0) {
            ctx.fillText(line, x, currentY);
            line = words[n];
            currentY += lineHeight;
        } else {
            line = testLine;
        }
    }
    ctx.fillText(line, x, currentY);
    return currentY + lineHeight;
};

const createReportPageImage = async (page: PageData): Promise<string> => {
    const canvas = document.createElement('canvas');
    const width = 1240, height = 1754; // A4 Standard DPI
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, width, height);
    
    // Header
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#1e293b'; ctx.font = 'bold 44px sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(`Evaluation Detail – Page ${page.pageNumber}`, 60, 60);
    
    if (page.evaluation) {
        ctx.textAlign = 'right'; ctx.fillStyle = '#059669'; ctx.font = 'bold 36px sans-serif';
        ctx.fillText(`Page Score: ${page.evaluation.averageScore}/10`, width - 60, 60);
    }

    // Image Comparison Section
    const imgY = 160, imgW = 540, imgH = 700, padding = 60;
    try {
        const original = await loadImage(page.originalImage);
        const translated = page.translatedImage ? await loadImage(page.translatedImage) : null;

        const drawInFrame = (img: HTMLImageElement, x: number, y: number, w: number, h: number, label: string) => {
            const ratio = img.width / img.height;
            let finalW = w, finalH = h;
            if (ratio > w/h) finalH = w / ratio; else finalW = h * ratio;
            ctx.drawImage(img, x + (w - finalW) / 2, y + (h - finalH) / 2, finalW, finalH);
            ctx.textAlign = 'center'; ctx.font = '24px sans-serif'; ctx.fillStyle = '#64748b';
            ctx.fillText(label, x + w / 2, y + h + 20);
        };

        drawInFrame(original, padding, imgY, imgW, imgH, "Original");
        if (translated) drawInFrame(translated, width - imgW - padding, imgY, imgW, imgH, "Translated");
    } catch (e) {
        ctx.fillStyle = '#f1f5f9'; ctx.fillRect(padding, imgY, width - 2*padding, imgH);
    }

    if (page.evaluation) {
        let curY = 960;
        ctx.textAlign = 'left'; ctx.fillStyle = '#1e293b'; ctx.font = 'bold 32px sans-serif';
        ctx.fillText("Detailed Metrics", padding, curY);
        curY += 60;

        const metrics = [
            { k: 'accuracy', l: 'Accuracy' }, { k: 'fluency', l: 'Fluency' },
            { k: 'consistency', l: 'Consistency' }, { k: 'terminology', l: 'Terminology' },
            { k: 'completeness', l: 'Completeness' }, { k: 'formatPreservation', l: 'Format Preservation' }
        ];

        ctx.font = '24px sans-serif';
        metrics.forEach((m, i) => {
            const v = (page.evaluation!.scores as any)[m.k] || 0;
            const x = padding + (i % 2) * 580;
            const y = curY + Math.floor(i / 2) * 60;
            
            ctx.fillStyle = '#475569'; ctx.textAlign = 'left';
            ctx.fillText(`${m.l}: ${v}`, x, y);

            // Progress Bar
            const barW = 250, barH = 12, barX = x + 250;
            ctx.fillStyle = '#f1f5f9'; ctx.fillRect(barX, y - 4, barW, barH);
            ctx.fillStyle = '#10b981'; ctx.fillRect(barX, y - 4, barW * (v/10), barH);
        });

        curY += 220;
        // Reason Section
        ctx.fillStyle = '#1e293b'; ctx.font = 'bold 32px sans-serif';
        ctx.fillText("评估原因 (Reason)", padding, curY);
        curY += 50;
        ctx.fillStyle = '#334155'; ctx.font = '24px sans-serif';
        curY = wrapText(ctx, page.evaluation.reason, padding, curY, width - 2*padding, 36);

        curY += 60;
        // Suggestions Section
        ctx.fillStyle = '#4f46e5'; ctx.font = 'bold 32px sans-serif';
        ctx.fillText("优化建议 (Suggestions)", padding, curY);
        curY += 50;
        ctx.fillStyle = '#4338ca'; ctx.font = 'italic 24px sans-serif';
        wrapText(ctx, page.evaluation.suggestions, padding, curY, width - 2*padding, 36);
    }

    return canvas.toDataURL('image/jpeg', 0.85);
};

export const generateEvaluationPdf = async (pages: PageData[]): Promise<Blob> => {
  const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
  const pdfWidth = pdf.internal.pageSize.getWidth();
  const pdfHeight = pdf.internal.pageSize.getHeight();

  for (let i = 0; i < pages.length; i++) {
      if (i > 0) pdf.addPage();
      const report = await createReportPageImage(pages[i]);
      pdf.addImage(report, 'JPEG', 0, 0, pdfWidth, pdfHeight);
  }
  return pdf.output('blob');
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
    let finalWidth = pdfWidth, finalHeight = pdfHeight;
    if (imgRatio > pdfRatio) finalHeight = pdfWidth / imgRatio; else finalWidth = pdfHeight * imgRatio;
    pdf.addImage(imgData, 'JPEG', (pdfWidth - finalWidth) / 2, (pdfHeight - finalHeight) / 2, finalWidth, finalHeight);
  }
  return pdf.output('blob');
};

export const generateComparisonPdf = async (pages: { original: string, translated: string }[]): Promise<Blob> => {
  const pdf = new jsPDF({ orientation: 'l', unit: 'mm', format: 'a4' });
  const pw = pdf.internal.pageSize.getWidth(), ph = pdf.internal.pageSize.getHeight();
  const margin = 10, gap = 5, boxW = (pw - 2*margin - gap) / 2, boxH = ph - 2*margin;
  for (let i = 0; i < pages.length; i++) {
    if (i > 0) pdf.addPage();
    const draw = (imgData: string, xBase: number) => {
        const props = pdf.getImageProperties(imgData);
        const r = props.width / props.height;
        let w = boxW, h = boxH;
        if (r > boxW/boxH) h = boxW / r; else w = boxH * r;
        pdf.addImage(imgData, 'JPEG', xBase + (boxW-w)/2, margin + (boxH-h)/2, w, h);
    };
    draw(await compressImageToJpeg(pages[i].original), margin);
    draw(await compressImageToJpeg(pages[i].translated), margin + boxW + gap);
  }
  return pdf.output('blob');
};
