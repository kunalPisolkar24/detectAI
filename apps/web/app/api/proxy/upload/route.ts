import { NextRequest, NextResponse } from 'next/server';
import { CanvasFactory } from 'pdf-parse/worker';
import mammoth from 'mammoth';
import { PDFParse, VerbosityLevel } from "pdf-parse";

export const config = {
  api: {
    bodyParser: false,
  }
};

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    const allowedTypes = [
      'text/plain',
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];

    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json({ error: 'Invalid file type. Only .txt, .pdf, and .docx are allowed.' }, { status: 400 });
    }

    const fileBuffer = Buffer.from(await file.arrayBuffer());
    let text = '';

    if (file.type === 'application/pdf') {
      const parser = new PDFParse({ data: fileBuffer, verbosity: VerbosityLevel.WARNINGS, CanvasFactory });
      const result = await parser.getText();
      const pageNumberRegex = /--\s*\d+\s+of\s+\d+\s*--/g;
      const cleanedText = result.text.replace(pageNumberRegex, '');
      text = cleanedText;
    } else if (file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      const result = await mammoth.extractRawText({ buffer: fileBuffer });
      text = result.value;
    } else {
      text = fileBuffer.toString('utf-8');
    }

    return NextResponse.json({ text });

  } catch (error) {
    console.error('Error processing file:', error);
    return NextResponse.json({ error: 'Failed to process file' }, { status: 500 });
  }
}