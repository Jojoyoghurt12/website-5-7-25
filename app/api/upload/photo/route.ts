// app/api/upload/route.ts

import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { Readable } from "stream";
console.log("GOOGLE_CLIENT_EMAIL:", process.env.GOOGLE_CLIENT_EMAIL);
console.log("GOOGLE_PRIVATE_KEY:", process.env.GOOGLE_PRIVATE_KEY?.slice(0, 20));


export const config = {
  api: {
    bodyParser: true, // enable default parser since we're accepting JSON now
  },
};

export async function POST(req: NextRequest) {
  try {
    const { imageBase64 } = await req.json();

    if (!imageBase64) {
      return NextResponse.json({ error: "No imageBase64 provided" }, { status: 400 });
    }

    // Remove data URL prefix if present
    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");
    const buffer = Buffer.from(base64Data, "base64");

    // Setup Google Drive auth using environment variables
    // Handle the private key properly - replace \\n with actual newlines
    const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');
    
    if (!privateKey || !process.env.GOOGLE_CLIENT_EMAIL) {
      return NextResponse.json({ error: "Missing Google credentials" }, { status: 500 });
    }

    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        private_key: privateKey,
      },
      scopes: ["https://www.googleapis.com/auth/drive.file"],
    });

    const drive = google.drive({ version: "v3", auth });

    // Upload buffer as a stream
    const uploadResponse = await drive.files.create({
      requestBody: {
        name: `photo-${Date.now()}.png`,
        parents: [process.env.GOOGLE_DRIVE_FOLDER_ID!],
        mimeType: "image/png",
      },
      media: {
        mimeType: "image/png",
        body: Readable.from(buffer),
      },
    });

    return NextResponse.json({ fileId: uploadResponse.data.id }, { status: 200 });
  } catch (error: any) {
    console.error("Upload error:", error);
    return NextResponse.json(
      { error: error.message || "Unexpected server error" },
      { status: 500 }
    );
  }
}