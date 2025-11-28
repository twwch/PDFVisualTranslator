import * as pdfjsLib from 'pdfjs-dist';
import { jsPDF } from 'jspdf';

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

export const generatePdfFromImages = (images: string[]): Blob => {
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

  images.forEach((imgData, index) => {
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
  });

  return pdf.output('blob');
};

export const generateComparisonPdf = (pages: { original: string, translated: string }[]): Blob => {
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

  pages.forEach((pageData, index) => {
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
    drawImageInBox(pageData.original, margin, margin, halfWidth, maxHeight);
    
    // Draw Translated Image on Right
    drawImageInBox(pageData.translated, margin + halfWidth + gap, margin, halfWidth, maxHeight);
    
    // Optional: Add small labels at the bottom if needed
    pdf.setFontSize(8);
    pdf.setTextColor(100);
    pdf.text("Original", margin, pageHeight - 5);
    pdf.text("Translated", margin + halfWidth + gap, pageHeight - 5);
  });

  return pdf.output('blob');
};