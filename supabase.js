/**
Supabase Storage Integration
Handles uploading and deleting chat attachments (Images, Audio, Video, PDFs).
*/
const SupabaseStorage = {
  url: "https://dtympkugrwxskqbjxjoj.supabase.co",
  key: "sb_publishable_SF9wuG1fHbE0dlh0gdFBUg_0qWUsuLA",
  bucketName: "chat-attachments",
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
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => resolve(URL.createObjectURL(file));
      reader.readAsDataURL(file);
    });
  },

  /**
  Upload file to Supabase bucket under conversation directory
  */
  async uploadFile(conversationId, file) {
    if (!this.client) this.init();

    // Clean filename
    const cleanName = (file.name || "attachment").replace(/[^a-zA-Z0-9._-]/g, "_");
    const filePath = `${conversationId}/${Date.now()}_${cleanName}`;

    try {
      const { data, error } = await this.client.storage
        .from(this.bucketName)
        .upload(filePath, file, {
          cacheControl: "3600",
          upsert: false
        });

      if (error) {
        console.warn("Supabase upload warning:", error.message);
        const dataUrl = await this.fileToDataUrl(file);
        return {
          path: filePath,
          url: dataUrl,
          name: file.name,
          type: file.type,
          size: file.size
        };
      }

      const { data: publicUrlData } = this.client.storage
        .from(this.bucketName)
        .getPublicUrl(filePath);

      return {
        path: filePath,
        url: publicUrlData.publicUrl,
        name: file.name,
        type: file.type,
        size: file.size
      };
    } catch (err) {
      console.warn("Upload exception, falling back to permanent data URL:", err);
      const dataUrl = await this.fileToDataUrl(file);
      return {
        path: filePath,
        url: dataUrl,
        name: file.name,
        type: file.type,
        size: file.size
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