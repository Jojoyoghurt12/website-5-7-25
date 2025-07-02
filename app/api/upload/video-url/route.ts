import { google } from "googleapis";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    // Add request body parsing with error handling
    let body;
    try {
      body = await req.json();
    } catch (parseError) {
      console.error("Failed to parse request body:", parseError);
      return NextResponse.json({ error: "Invalid JSON in request body" }, { status: 400 });
    }

    const { filename, mimeType, fileSize } = body;

    // Validate required fields
    if (!filename || !mimeType) {
      return NextResponse.json({ 
        error: "Missing required fields: filename and mimeType are required" 
      }, { status: 400 });
    }

    // Check environment variables
    const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
    const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
    const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;

    if (!privateKey || !clientEmail || !folderId) {
      console.error("Missing environment variables:", {
        hasPrivateKey: !!privateKey,
        hasClientEmail: !!clientEmail,
        hasFolderId: !!folderId
      });
      return NextResponse.json({ 
        error: "Missing Google credentials or folder ID" 
      }, { status: 500 });
    }

    console.log(`Creating resumable upload for: ${filename} (${fileSize ? (fileSize / 1024 / 1024).toFixed(2) + 'MB' : 'unknown size'})`);

    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: clientEmail,
        private_key: privateKey,
      },
      scopes: ["https://www.googleapis.com/auth/drive.file"],
    });

    // Get the auth client with access token
    const authClient = await auth.getClient();
    const accessToken = (await authClient.getAccessToken()).token;

    if (!accessToken) {
      console.error("Failed to get access token from Google Auth");
      return NextResponse.json({ error: "Failed to get access token" }, { status: 500 });
    }

    console.log("Successfully got access token, initiating resumable upload...");

    // Create headers for resumable upload
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": mimeType,
    };

    // Add content length if file size is provided
    if (fileSize) {
      headers["X-Upload-Content-Length"] = fileSize.toString();
    }

    // Initiate resumable upload session
    const response = await fetch(
      `https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: filename,
          parents: [folderId],
          mimeType,
        }),
      }
    );

    console.log(`Resumable upload initiation response: ${response.status} ${response.statusText}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Error initiating resumable upload:", {
        status: response.status,
        statusText: response.statusText,
        errorText,
        headers: Object.fromEntries(response.headers.entries())
      });
      
      // More specific error messages based on status codes
      let errorMessage = `Failed to initiate upload: ${response.status} ${response.statusText}`;
      
      if (response.status === 401) {
        errorMessage = "Authentication failed - check Google credentials";
      } else if (response.status === 403) {
        errorMessage = "Permission denied - check Google Drive folder permissions";
      } else if (response.status === 404) {
        errorMessage = "Google Drive folder not found - check folder ID";
      }
      
      return NextResponse.json({ error: errorMessage }, { status: 500 });
    }

    const uploadUrl = response.headers.get("location");

    if (!uploadUrl) {
      console.error("No upload URL returned from Google Drive API");
      console.log("Response headers:", Object.fromEntries(response.headers.entries()));
      return NextResponse.json({ error: "No upload URL returned from Google Drive" }, { status: 500 });
    }

    console.log("Successfully created resumable upload URL");
    return NextResponse.json({ 
      uploadUrl,
      message: `Resumable upload URL created for ${filename}`
    });

  } catch (err: any) {
    console.error("Unexpected error in video upload route:", {
      message: err.message,
      stack: err.stack,
      name: err.name
    });
    
    // More specific error handling
    let errorMessage = "Unexpected server error";
    
    if (err.code === 'ENOTFOUND') {
      errorMessage = "Network error - unable to reach Google Drive API";
    } else if (err.message?.includes('timeout')) {
      errorMessage = "Request timeout - Google Drive API is slow to respond";
    } else if (err.message) {
      errorMessage = `Server error: ${err.message}`;
    }
    
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}