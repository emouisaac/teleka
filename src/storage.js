import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

import { config } from "./config.js";

const supabase = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

function sanitizeFileName(fileName) {
  return String(fileName || "file")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_");
}

export async function initializeStorage() {
  const { data: buckets, error: listError } = await supabase.storage.listBuckets();
  if (listError) {
    throw new Error(`Unable to list Supabase storage buckets: ${listError.message}`);
  }

  const existing = buckets.find((bucket) => bucket.name === config.supabaseUploadBucket);
  if (existing) {
    return;
  }

  const { error: createError } = await supabase.storage.createBucket(config.supabaseUploadBucket, {
    public: false,
    fileSizeLimit: 10 * 1024 * 1024,
    allowedMimeTypes: [
      "image/jpeg",
      "image/png",
      "image/webp",
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ]
  });

  if (createError && !/already exists/i.test(createError.message)) {
    throw new Error(`Unable to create Supabase storage bucket: ${createError.message}`);
  }
}

export async function uploadFile({ folder, file }) {
  const safeName = sanitizeFileName(file.originalname);
  const objectPath = `${folder}/${Date.now()}-${randomUUID()}-${safeName}`;

  const { error } = await supabase.storage
    .from(config.supabaseUploadBucket)
    .upload(objectPath, file.buffer, {
      contentType: file.mimetype || "application/octet-stream",
      upsert: false
    });

  if (error) {
    throw new Error(`Unable to upload ${file.originalname}: ${error.message}`);
  }

  return {
    objectPath,
    originalName: file.originalname,
    storedName: safeName,
    mimeType: file.mimetype || null
  };
}

export async function removeFiles(objectPaths) {
  const targets = objectPaths.filter(Boolean);
  if (!targets.length) {
    return;
  }

  const { error } = await supabase.storage
    .from(config.supabaseUploadBucket)
    .remove(targets);

  if (error) {
    console.warn(`Unable to remove Supabase storage objects: ${error.message}`);
  }
}

export async function downloadFile(objectPath) {
  const { data, error } = await supabase.storage
    .from(config.supabaseUploadBucket)
    .download(objectPath);

  if (error) {
    throw new Error(`Unable to download storage object ${objectPath}: ${error.message}`);
  }

  const arrayBuffer = await data.arrayBuffer();
  return {
    buffer: Buffer.from(arrayBuffer),
    contentType: data.type || "application/octet-stream"
  };
}

export async function createSignedUrl(objectPath, expiresInSeconds = 60 * 10) {
  if (!objectPath) {
    return null;
  }

  const { data, error } = await supabase.storage
    .from(config.supabaseUploadBucket)
    .createSignedUrl(objectPath, expiresInSeconds);

  if (error) {
    throw new Error(`Unable to create signed URL for ${objectPath}: ${error.message}`);
  }

  return data.signedUrl;
}
