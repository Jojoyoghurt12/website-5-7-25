// Updated page.tsx with chunked photo uploads

"use client"

import React, { useRef, useState } from "react";
import { Upload, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';

export default function Page() {
  const videoRef = useRef<HTMLVideoElement>(null); 
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [cameraStarted, setCameraStarted] = useState(false);
  const [facingMode, setFacingMode] = useState<"user" | "environment">("user");
  const [photo, setPhoto] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<{[key: string]: number}>({});
  const [uploadingFiles, setUploadingFiles] = useState<string[]>([]);

  // Video upload states
  const [videoFile, setVideoFile] = useState<File | null>(null);

  const startCamera = async (mode: "user" | "environment" = "user") => {
    setError(null);
    setPhoto(null);
    setUploadResult(null);

    if (cameraStarted) {
      stopCamera();
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { exact: mode } },
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        setCameraStarted(true);
        setFacingMode(mode);
      }
    } catch (err: any) {
      setError(err.message || "Unable to access camera.");
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      (videoRef.current.srcObject as MediaStream)
        .getTracks()
        .forEach((track) => track.stop());
      videoRef.current.srcObject = null;
    }
    setCameraStarted(false);
  };

  // Updated photo upload using chunked method
  const uploadPhotoChunked = async (imageData: string) => {
    setUploading(true);
    setUploadResult(null);
    setError(null);

    try {
      // Convert base64 to blob for chunked upload
      const base64Data = imageData.replace(/^data:image\/\w+;base64,/, "");
      const byteCharacters = atob(base64Data);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: 'image/png' });
      
      // Create a File object from the blob
      const file = new File([blob], `photo-${Date.now()}.png`, { type: 'image/png' });
      
      // Use the same chunked upload method as videos
      const fileId = `camera-photo-${Date.now()}`;
      await uploadFileChunked(file, fileId);
      
      setUploadResult(`Photo uploaded successfully!`);
    } catch (err: any) {
      console.error("Photo upload error:", err);
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  const takePhoto = () => {
    if (!videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Flip the canvas horizontally for front camera
    if (facingMode === "user") {
      ctx.scale(-1, 1);
      ctx.drawImage(video, -canvas.width, 0, canvas.width, canvas.height);
    } else {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    }

    const dataURL = canvas.toDataURL("image/png");
    setPhoto(dataURL);
    stopCamera();
    uploadPhotoChunked(dataURL); // Use new chunked method
  };

  const compressImage = (file: File, maxWidth: number = 1920, quality: number = 0.8): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const img = new Image();
      
      img.onload = () => {
        // Calculate new dimensions
        let { width, height } = img;
        
        if (width > maxWidth) {
          height = (height * maxWidth) / width;
          width = maxWidth;
        }
        
        canvas.width = width;
        canvas.height = height;
        
        // Draw and compress
        ctx?.drawImage(img, 0, 0, width, height);
        canvas.toBlob((blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error('Failed to compress image'));
          }
        }, 'image/jpeg', quality);
      };
      
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  };

  const toggleCamera = () => {
    startCamera(facingMode === "user" ? "environment" : "user");
  };

  // Generic chunked upload function for both photos and videos
  const uploadFileChunked = async (file: File, fileId: string): Promise<any> => {
    // Step 1: Get resumable upload URL
    console.log(`Getting upload URL for: ${file.name}`);
    setUploadProgress(prev => ({ ...prev, [fileId]: 5 }));

    const urlResponse = await fetch('/api/upload/video-url', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        filename: file.name,
        mimeType: file.type,
        fileSize: file.size
      })
    });

    if (!urlResponse.ok) {
      const errorData = await urlResponse.json().catch(() => ({}));
      throw new Error(errorData.error || 'Failed to get upload URL');
    }

    const { uploadUrl } = await urlResponse.json();
    setUploadProgress(prev => ({ ...prev, [fileId]: 10 }));

    // Step 2: Upload using resumable upload
    console.log(`Starting chunked upload: ${file.name}`);
    return await resumableUpload(file, uploadUrl, fileId);
  };

  // Resumable upload function for large files
  const resumableUpload = async (file: File, uploadUrl: string, fileId: string): Promise<any> => {
    const chunkSize = 256 * 1024; // 256KB chunks
    const totalChunks = Math.ceil(file.size / chunkSize);
    
    console.log(`Starting resumable upload: ${file.name}, ${totalChunks} chunks`);
    
    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
      const start = chunkIndex * chunkSize;
      const end = Math.min(start + chunkSize, file.size);
      const chunk = file.slice(start, end);
      
      const success = await uploadChunk(chunk, start, end - 1, file.size, uploadUrl, fileId, chunkIndex, totalChunks);
      
      if (!success) {
        // Retry the chunk once
        console.log(`Retrying chunk ${chunkIndex + 1}/${totalChunks}`);
        const retrySuccess = await uploadChunk(chunk, start, end - 1, file.size, uploadUrl, fileId, chunkIndex, totalChunks);
        if (!retrySuccess) {
          throw new Error(`Failed to upload chunk ${chunkIndex + 1}/${totalChunks} after retry`);
        }
      }
      
      // Update progress (10% for getting URL, 90% for upload)
      const progressPercent = 10 + Math.round((end / file.size) * 90);
      setUploadProgress(prev => ({ ...prev, [fileId]: progressPercent }));
    }
    
    return { success: true, id: `uploaded_${Date.now()}`, name: file.name };
  };

  const uploadChunk = (chunk: Blob, start: number, end: number, totalSize: number, uploadUrl: string, fileId: string, chunkIndex: number, totalChunks: number): Promise<boolean> => {
    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      
      // Set timeout for each chunk (30 seconds)
      xhr.timeout = 30000;
      
      xhr.addEventListener('load', () => {
        if (xhr.status === 308) {
          // Partial content uploaded, continue
          console.log(`Chunk ${chunkIndex + 1}/${totalChunks} uploaded successfully`);
          resolve(true);
        } else if (xhr.status >= 200 && xhr.status < 300) {
          // Upload complete
          console.log(`Final chunk ${chunkIndex + 1}/${totalChunks} uploaded, upload complete`);
          resolve(true);
        } else {
          console.error(`Chunk ${chunkIndex + 1}/${totalChunks} failed: ${xhr.status} ${xhr.statusText}`);
          resolve(false);
        }
      });

      xhr.addEventListener('error', () => {
        console.error(`Chunk ${chunkIndex + 1}/${totalChunks} network error`);
        resolve(false);
      });

      xhr.addEventListener('timeout', () => {
        console.error(`Chunk ${chunkIndex + 1}/${totalChunks} timeout`);
        resolve(false);
      });

      xhr.open('PUT', uploadUrl);
      xhr.setRequestHeader('Content-Range', `bytes ${start}-${end}/${totalSize}`);
      xhr.send(chunk);
    });
  };

  // Updated unified upload function
  const handleUnifiedUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    console.log(`Starting upload of ${files.length} files`);
    const uploadTasks: Promise<void>[] = [];
    setError(null);

    Array.from(files).forEach((file, index) => {
      const task = (async () => {
        const fileId = `${file.name}-${index}`;
        console.log(`Processing file: ${file.name} (${file.type})`);
        
        setUploadingFiles(prev => [...prev, fileId]);
        setUploadProgress(prev => ({ ...prev, [fileId]: 0 }));

        try {
          if (file.type.startsWith("image/")) {
            // Handle image upload with chunked method
            console.log(`Processing image: ${file.name}`);
            setUploadProgress(prev => ({ ...prev, [fileId]: 5 }));
            
            // Compress the image first
            const compressedBlob = await compressImage(file);
            const compressedFile = new File([compressedBlob], file.name, { type: 'image/jpeg' });
            
            // Upload using chunked method
            await uploadFileChunked(compressedFile, fileId);
            
            console.log(`Successfully uploaded image: ${file.name}`);

          } else if (file.type.startsWith("video/")) {
            // Handle video upload with chunked method
            console.log(`Processing video: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`);
            
            // Validate file size (max 500MB)
            const maxSize = 500 * 1024 * 1024;
            if (file.size > maxSize) {
              throw new Error('Video file must be less than 500MB');
            }

            // Upload using chunked method
            await uploadFileChunked(file, fileId);
            
            console.log(`Successfully uploaded video: ${file.name}`);
          }

        } catch (error: any) {
          console.error(`Error uploading ${file.name}:`, error);
          const isCorsError = error.message?.includes('CORS') || 
                   error.message?.includes('Access-Control-Allow-Origin');

          const isChunkError = error.message?.includes('Chunk') ||
                  error.message?.includes('chunk')

          if (isCorsError || isChunkError) {
            console.log('CORS error occurred but upload may have succeeded');
          } else {
            setError(`Failed to upload ${file.name}: ${error.message}`);
            setUploadProgress(prev => ({ ...prev, [fileId]: 0 }));
          }
        } finally {
          // Remove from uploading files list
          setUploadingFiles(prev => prev.filter(id => id !== fileId));
        }
      })();

      uploadTasks.push(task);
    });

    // Wait for all uploads to complete
    await Promise.all(uploadTasks);
    console.log('All uploads completed');
  };

  return (
    <div className="p-6 w-[360px] mx-auto">
      <h1 className="garamond-title box-text text-2xl text-center">
        Oslava 50tky – Monika a Palo
      </h1>
      <div className="border -ml-4" />
      
      {/* Camera Controls */}
      <div className="flex flex-wrap gap-3 justify-center mb-4">
        <button
          onClick={toggleCamera}
          disabled={!cameraStarted}
          className={`${ 
            cameraStarted ? "garamond box px-4 py-2 rounded-lg hover:bg-white disabled:bg-gray-200" : ""}`}
        >
          {cameraStarted ? facingMode === "user" ? "Zadná" : "Predná"  : " "}
          {cameraStarted ? " Kamera" : " "}
        </button>

        {photo && (
          <div className="flex gap-4 justify-center mt-2">
            <button
              onClick={() => {
                if (!photo) return;
                const link = document.createElement("a");
                link.href = photo;
                link.download = "photo.png";
                link.click();
              }}
              className="garamond box px-4 py-2 text-white rounded-lg hover:bg-white disabled:bg-gray-300 mr-[7px]"
            >
              Stiahni fotku
            </button>
          </div>
        )}
        
        <div className="flex gap-4 justify-center mt-2">
          <a
            className={`${
              uploading ? "garamond box-loading px-4 py-2 bg-gray-400 text-white rounded-lg " : " "
            }`}
          >
            {uploading ? "Nahráva sa fotka..." : " "}
          </a>               
        </div>

        {error && <p className="text-red-500 text-center mb-2">Error: {error}</p>}

        {/* Camera View */}
        {photo ? (
          <div className="text-center">
            <img
              src={photo}
              alt="Captured"
              className="photo rounded-lg shadow-md border mr-[7px]"
            />
          </div>
        ) : (
          <div className="flex flex-col items-center">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              className={`photo rounded-lg bg-black mx-auto ${
                facingMode === "user" ? "scale-x-[-1]" : ""
              }`}
            />

            {cameraStarted && (
              <button
                onClick={takePhoto}
                disabled={!cameraStarted}
                className="camera mt-4 rounded-lg hover:bg-black/60 disabled:bg-gray-200"
              />
            )}
          </div>
        )}

        <button
          onClick={() => startCamera(facingMode)}
          disabled={cameraStarted || uploadingFiles.length > 0}
          className={`${
            cameraStarted ? " " : "garamond box px-4 py-2 rounded-lg"
          } hover:bg-white disabled:bg-gray-400`}
        >
          {cameraStarted ? " " : "Zapni kameru"}
        </button>

        <a
          href="https://drive.google.com/drive/folders/1qjlwQb-vuyPcv2VkNh8x5B3vulErvNSu"
          target="_blank"
          rel="noopener noreferrer"
          className={`${
            cameraStarted ? " " : "garamond box px-4 py-2 text-white rounded-lg hover:bg-white"}`}
        > 
          {cameraStarted ? " ": "Otvor Album"}
        </a>
      </div>

      {/* Upload Progress */}
      {uploadingFiles.length > 0 && (
        <div className="mt-4 space-y-2">
          <h3 className="text-sm font-medium text-center">Nahrávanie súborov...</h3>
          {uploadingFiles.map((fileId) => (
            <div key={fileId} className="bg-white-200 rounded-full h-2">
              <div
                className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                style={{ width: `${uploadProgress[fileId] || 0}%` }}
              />
              <div className="text-xs text-center mt-1">
                {fileId.split('-')[0]} - {Math.round(uploadProgress[fileId] || 0)}%
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Unified File Upload */}
      <div className="mt-6 border-t pt-4">
        <div className="border-2 border-dashed gold-color rounded-lg p-6 text-center hover:border-gray-400 transition-colors">
          <Upload className="mx-auto mb-4" size={32} />
          <label className="cursor-pointer gold-color">
            <span className="garamond box-text px-4 py-2 text-base font-medium text-gray-700 hover:text-gray-900">
              Nahraj fotky a videá
            </span>
            <input
              type="file"
              accept="image/*, video/*"
              multiple
              onChange={handleUnifiedUpload}
              className="hidden"
              disabled={uploadingFiles.length > 0}
            />
          </label>
        </div>
      </div>

      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}