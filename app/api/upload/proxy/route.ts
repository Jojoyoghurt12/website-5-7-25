import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const uploadUrl = formData.get('uploadUrl') as string;

    if (!file || !uploadUrl) {
      return NextResponse.json({ error: 'Missing file or upload URL' }, { status: 400 });
    }

    console.log("Proxying upload to Google Drive for:", file.name);

    // Upload to Google Drive from server (no CORS issues here)
    const uploadResponse = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': file.type,
        'Content-Length': file.size.toString(),
      },
      body: file.stream(), // Use stream for better memory efficiency
      duplex: 'half', // Required when using streams in Node.js fetch
    } as RequestInit);

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      console.error("Drive upload error:", errorText);
      return NextResponse.json(
        { error: `Drive upload failed: ${uploadResponse.status}` },
        { status: uploadResponse.status }
      );
    }

    // Try to parse as JSON, but handle cases where it's not JSON
    let result;
    const responseText = await uploadResponse.text();
    
    try {
      result = JSON.parse(responseText);
    } catch (parseError) {
      // If it's not JSON, create a basic result object
      console.log("Response is not JSON, creating basic result");
      result = {
        success: true,
        id: `uploaded_${Date.now()}`, // Fallback ID
        name: file.name
      };
    }

    console.log("Successfully uploaded to Google Drive:", result);

    return NextResponse.json({ 
      success: true, 
      fileId: result.id || `uploaded_${Date.now()}`,
      fileName: file.name 
    });

  } catch (error) {
    console.error("Proxy upload error:", error);
    return NextResponse.json(
      { error: `Upload proxy failed: ${error instanceof Error ? error.message : 'Unknown error'}` },
      { status: 500 }
    );
  }
}