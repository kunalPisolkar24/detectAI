import { NextRequest, NextResponse } from 'next/server';
import 'pdf-parse/worker';
import mammoth from 'mammoth';
import {getWorkerPath} from "pdf-parse/worker";
import {PDFParse, VerbosityLevel} from "pdf-parse";
PDFParse.setWorker(getWorkerPath());

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

    const fileBuffer = Buffer.from(await file.arrayBuffer());
    let text = '';

    if (file.type === 'application/pdf') {
      const parser = new PDFParse({ data: fileBuffer, verbosity: VerbosityLevel.WARNINGS });
      const result = await parser.getText();
      const pageNumberRegex = /--\s*\d+\s+of\s+\d+\s*--/g;
      const cleanedText = result.text.replace(pageNumberRegex, '');
      console.log("Text successfully cleaned.");
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