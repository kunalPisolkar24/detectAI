import { NextRequest, NextResponse } from 'next/server';

export async function POST(
  request: NextRequest,
) {
  try {
    // Extract the endpoint from the URL pathname
    const endpoint = request.nextUrl.pathname.split('/').pop();
    
    const body = await request.json();
    
    const apiUrl = `${process.env.NEXT_PUBLIC_MODEL_URL}/predict/${endpoint}`;
    
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.NEXT_PUBLIC_MODEL_API_SECRET}`,
      },
      body: JSON.stringify(body),
    });
    
    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch prediction' },
      { status: 500 }
    );
  }
}