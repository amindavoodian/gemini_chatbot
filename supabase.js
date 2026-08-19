/**
Supabase Storage Integration
Handles uploading and deleting chat attachments (Images, Audio, Video, PDFs).
Supports File objects, Blobs, and queued Data URLs from background sync.
*/
const SupabaseStorage = {
  url: "https://dtympkugrwxskqbjxjoj.supabase.co",
  key: "sb_publishable_SF9wuG1fHbE0dlh0gdFBUg_0qWUsuLA",
  bucketName: "g_chatbot",
  client: null,

  init() {
    if (window.supabase) {
      this.client = window.supabase.createClient(this.url, this.key);
      console.log("Supabase Storage client initialized.");
    } else {
      console.error("Supabase CDN not loaded.");
    }
  },

  /**
  Helper: Convert file to Base64 Data URL so it persists permanently in history
  */
  fileToDataUrl(file) {
    return new Promise((resolve) => {
      if (!file) return resolve("");
      if (typeof file === "string") return resolve(file);
      if (file.dataUrl) return resolve(file.dataUrl);

      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => {
        try {
          resolve(URL.createObjectURL(file));
        } catch (e) {
          resolve("");
        }
      };
      reader.readAsDataURL(file);
    });
  },

  /**
  Helper: Convert Data URL back to Blob for Supabase upload
  */
  async dataUrlToBlob(dataUrl) {
    try {
      const res = await fetch(dataUrl);
      return await res.blob();
    } catch (e) {
      return null;
    }
  },

  /**
  Upload file to Supabase bucket under conversation directory
  Supports File objects or serialized { name, type, size, dataUrl } from offline queue.
  */
  async uploadFile(conversationId, file) {
    if (!this.client) this.init();

    const fileName = file.name || "attachment";
    const fileType = file.type || "application/octet-stream";
    const fileSize = file.size || 0;
    const cleanName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const filePath = `${conversationId}/${Date.now()}_${cleanName}`;

    let uploadPayload = file;
    let fallbackDataUrl = file.dataUrl || "";

    // If file is from offline queue or serialized dataUrl
    if (file.dataUrl && !(file instanceof File || file instanceof Blob)) {
      const blob = await this.dataUrlToBlob(file.dataUrl);
      if (blob) {
        uploadPayload = blob;
      }
    } else if (!fallbackDataUrl && (file instanceof File || file instanceof Blob)) {
      fallbackDataUrl = await this.fileToDataUrl(file);
    }

    try {
      const { data, error } = await this.client.storage
        .from(this.bucketName)
        .upload(filePath, uploadPayload, {
          contentType: fileType,
          cacheControl: "3600",
          upsert: false
        });

      if (error) {
        console.warn("Supabase upload warning:", error.message);
        return {
          path: filePath,
          url: fallbackDataUrl,
          name: fileName,
          type: fileType,
          size: fileSize
        };
      }

      const { data: publicUrlData } = this.client.storage
        .from(this.bucketName)
        .getPublicUrl(filePath);

      return {
        path: filePath,
        url: publicUrlData.publicUrl,
        name: fileName,
        type: fileType,
        size: fileSize
      };
    } catch (err) {
      console.warn("Upload exception, falling back to permanent data URL:", err);
      return {
        path: filePath,
        url: fallbackDataUrl,
        name: fileName,
        type: fileType,
        size: fileSize
      };
    }
  },

  /**
  Delete single or multiple files from Supabase Storage
  */
  async deleteFiles(filePaths) {
    if (!this.client || !filePaths || filePaths.length === 0) return;
    try {
      await this.client.storage.from(this.bucketName).remove(filePaths);
    } catch (err) {
      console.warn("Supabase remove files warning:", err);
    }
  },

  /**
  Delete all files belonging to a specific conversation
  */
  async deleteConversationFiles(conversationId) {
    if (!this.client) return;
    try {
      const { data: list, error } = await this.client.storage
        .from(this.bucketName)
        .list(conversationId);
      if (list && list.length > 0) {
        const paths = list.map(item => `${conversationId}/${item.name}`);
        await this.client.storage.from(this.bucketName).remove(paths);
      }
    } catch (err) {
      console.warn("Supabase remove conversation files warning:", err);
    }
  },

  /**
  Clear all uploaded files from storage bucket
  */
  async clearAllStorage() {
    if (!this.client) return;
    try {
      const { data: folders } = await this.client.storage.from(this.bucketName).list();
      if (folders && folders.length > 0) {
        for (const item of folders) {
          const { data: files } = await this.client.storage.from(this.bucketName).list(item.name);
          if (files && files.length > 0) {
            const paths = files.map(f => `${item.name}/${f.name}`);
            await this.client.storage.from(this.bucketName).remove(paths);
          }
        }
      }
    } catch (err) {
      console.warn("Supabase clear storage warning:", err);
    }
  }
};