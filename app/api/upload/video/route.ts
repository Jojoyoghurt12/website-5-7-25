// app/api/upload/video/route.ts

import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import fs from "fs";
import os from "os";
import path from "path";

export const config = {
  api: {
    bodyParser: false,
  },
};

const getDriveClient = () => {
  const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;

  if (!privateKey || !clientEmail) {
    throw new Error("Missing Google credentials");
  }

  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: clientEmail,
      private_key: privateKey,
    },
    scopes: ["https://www.googleapis.com/auth/drive.file"],
  });

  return google.drive({ version: "v3", auth });
};

export async function POST(req: NextRequest) {
  try {
    console.log("Starting video upload...");
    
    // Get the form data directly from NextRequest
    const formData = await req.formData();
    const file = formData.get('video') as File;
    
    if (!file) {
      console.error("No file found in upload");
      return NextResponse.json({ error: "No valid video file uploaded" }, { status: 400 });
    }

    console.log("File found:", {
      name: file.name,
      type: file.type,
      size: file.size
    });

    // Convert File to Buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    // Create temporary file
    const tempDir = os.tmpdir();
    const tempFilePath = path.join(tempDir, `upload-${Date.now()}-${file.name}`);
    
    console.log("Writing temporary file:", tempFilePath);
    fs.writeFileSync(tempFilePath, buffer);

    console.log("Initializing Google Drive client...");
    const drive = getDriveClient();
    
    console.log("Creating file stream...");
    const fileStream = fs.createReadStream(tempFilePath);

    console.log("Uploading to Google Drive...");
    const uploadResponse = await drive.files.create({
      requestBody: {
        name: file.name || `video-${Date.now()}.mp4`,
        parents: [process.env.GOOGLE_DRIVE_FOLDER_ID!],
        mimeType: file.type || "video/mp4",
      },
      media: {
        mimeType: file.type || "video/mp4",
        body: fileStream,
      },
    });

    console.log("Upload successful, file ID:", uploadResponse.data.id);

    // Clean up temporary file
    try {
      fs.unlinkSync(tempFilePath);
      console.log("Temporary file cleaned up");
    } catch (cleanupError) {
      console.warn("Failed to cleanup temporary file:", cleanupError);
    }

    return NextResponse.json({ fileId: uploadResponse.data.id });
  } catch (error: any) {
    console.error("Video upload error:", error);
    console.error("Error stack:", error.stack);

    // Always return JSON error with proper status code
    const message = error?.message || "Unexpected server error";
    const statusCode = error?.statusCode || error?.status || 500;

    return NextResponse.json(
      { error: message },
      { status: statusCode }
    );
  }
}