import axios from 'axios';
import type { FastifyInstance } from 'fastify';

export default class LinkedInService {
  fastify: FastifyInstance | any;
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
  apiBaseUrl: string;
  scope: string;
  axiosConfig: Record<string, any>;

  constructor(fastify: FastifyInstance | any) {
    this.fastify = fastify;
    this.clientId = process.env.LINKEDIN_CLIENT_ID;
    this.clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
    this.redirectUri = process.env.LINKEDIN_REDIRECT_URI;
    this.apiBaseUrl = "https://api.linkedin.com/v2";
    this.scope = "openid profile email w_member_social"

    // Set default axios timeouts for LinkedIn API requests
    this.axiosConfig = {
      timeout: 10000, // 10 second timeout
      headers: {
        'X-Restli-Protocol-Version': '2.0.0',
        'LinkedIn-Version': '202501',
      },
    };

    // Log configuration for debugging
    this.fastify?.log?.info?.('LinkedIn service initialized', {
      hasClientId: !!this.clientId,
      hasClientSecret: !!this.clientSecret,
      hasRedirectUri: !!this.redirectUri,
    });
  }

  // Generate LinkedIn OAuth URL
  getAuthUrl(state = ''): string {
    const queryParams = new URLSearchParams({
      response_type: 'code',
      client_id: this.clientId || '',
      redirect_uri: this.redirectUri || '',
      scope: this.scope,
      state: state,
    });

    return `https://www.linkedin.com/oauth/v2/authorization?${queryParams.toString()}`;
  }

  // Exchange code for access token
  async getAccessToken(code: string): Promise<any> {
    try {
      const response = await axios.post(
        'https://www.linkedin.com/oauth/v2/accessToken',
        new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          client_id: this.clientId || '',
          client_secret: this.clientSecret || '',
          redirect_uri: this.redirectUri || '',
        }).toString(),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );

      return response.data;
    } catch (err: any) {
      const error = err as any;
      this.fastify?.log?.error?.(
        'Error getting access token:',
        error.response?.data || error.message
      );
      throw new Error(
        error.response?.data?.error_description || 'Failed to get access token'
      );
    }
  }

  // Get user profile
  async getUserProfile(accessToken: string): Promise<any> {
    try {
      const response = await axios.get(`${this.apiBaseUrl}/userinfo`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      const data = response.data;
      return {
        id: data.sub,
        vanity_name: data.name,
        metadata: {
          firstName: data.given_name,
          lastName: data.family_name,
          localizedFirstName: data.given_name,
          localizedLastName: data.family_name,
          picture: data.picture,
          email: data.email,
        },
      };
    } catch (err: any) {
      const error = err as any;
      this.fastify?.log?.error?.(
        'Error getting user profile:',
        error.response?.data || error.message
      );
      throw new Error('Failed to get user profile');
    }
  }

  // Text post
  async createTextPost(accessToken: any, text: string): Promise<any> {
    try {
      const response = await axios.post(
        `${this.apiBaseUrl}/ugcPosts`,
        {
          author: `urn:li:person:${accessToken.person_urn}`,
          lifecycleState: "PUBLISHED",
          specificContent: {
            "com.linkedin.ugc.ShareContent": {
              shareCommentary: { text },
              shareMediaCategory: "NONE",
            },
          },
          visibility: {
            "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC",
          },
        },
        {
          headers: {
            Authorization: `Bearer ${accessToken.access_token}`,
            "Content-Type": "application/json",
          },
        }
      );
      return response.data;
    } catch (error) {
      const e = error as any;
      this.fastify?.log?.error?.('Error creating text post:', e.response?.data || e.message);
      throw new Error('Failed to create text post');
    }
  }

  // Link post
  async createLinkPost(accessToken: any, text: string, linkUrl: string): Promise<any> {
    try {
      const response = await axios.post(
        `${this.apiBaseUrl}/ugcPosts`,
        {
          author: `urn:li:person:${accessToken.person_urn}`,
          lifecycleState: "PUBLISHED",
          specificContent: {
            "com.linkedin.ugc.ShareContent": {
              shareCommentary: { text },
              shareMediaCategory: "ARTICLE",
              media: [{ status: "READY", originalUrl: linkUrl }],
            },
          },
          visibility: {
            "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC",
          },
        },
        {
          headers: {
            Authorization: `Bearer ${accessToken.access_token}`,
            "Content-Type": "application/json",
          },
        }
      );
      return response.data;
    } catch (error) {
      const e = error as any;
      this.fastify?.log?.error?.('Error creating link post:', e.response?.data || e.message);
      throw new Error('Failed to create link post');
    }
  }

  // Image post
  async createImagePost(accessToken: any, text: string, imageBuffer: any, imageType: string): Promise<any> {
    try {
      // Step 1: Register upload
      const registerRes = await axios.post(
        `${this.apiBaseUrl}/assets?action=registerUpload`,
        {
          registerUploadRequest: {
            owner: `urn:li:person:${accessToken.person_urn}`,
            recipes: ["urn:li:digitalmediaRecipe:feedshare-image"],
            serviceRelationships: [
              {
                relationshipType: "OWNER",
                identifier: "urn:li:userGeneratedContent",
              },
            ],
          },
        },
        {
          headers: {
            Authorization: `Bearer ${accessToken.access_token}`,
            "Content-Type": "application/json",
          },
        }
      );

      const uploadUrl =
        registerRes.data.value.uploadMechanism[
          "com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest"
        ].uploadUrl;
      const assetUrn = registerRes.data.value.asset;

      // Step 2: Upload binary
      await axios.put(uploadUrl, imageBuffer, {
        headers: {
          Authorization: `Bearer ${accessToken.access_token}`,
          "Content-Type": imageType,
        },
      });

      // Step 3: Create post referencing the asset
      const postResponse = await axios.post(
        `${this.apiBaseUrl}/ugcPosts`,
        {
          author: `urn:li:person:${accessToken.person_urn}`,
          lifecycleState: "PUBLISHED",
          specificContent: {
            "com.linkedin.ugc.ShareContent": {
              shareCommentary: { text },
              shareMediaCategory: "IMAGE",
              media: [{ status: "READY", media: assetUrn }],
            },
          },
          visibility: {
            "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC",
          },
        },
        {
          headers: {
            Authorization: `Bearer ${accessToken.access_token}`,
            "Content-Type": "application/json",
          },
        }
      );

      return postResponse.data;
    } catch (error) {
      const e = error as any;
      this.fastify?.log?.error?.('Error creating image post:', e.response?.data || e.message);
      throw new Error('Failed to create image post');
    }
  }

  // Video post — uses /v2/assets with feedshare-video recipe (same approach as images,
  // works with w_member_social scope without needing LinkedIn Marketing API access)
  async uploadVideoToLinkedIn(
    accessToken: any,
    videoBuffer: Buffer,
    videoType: string,
  ): Promise<string> {
    // Normalize person URN
    if (!accessToken.person_urn) {
      const profileRes = await axios.get(`${this.apiBaseUrl}/userinfo`, {
        headers: { Authorization: `Bearer ${accessToken.access_token}` },
      });
      accessToken.person_urn = profileRes.data.sub;
    } else {
      accessToken.person_urn = accessToken.person_urn.replace(/^urn:li:person:/, '');
    }

    const authHeaders = {
      Authorization: `Bearer ${accessToken.access_token}`,
      'Content-Type': 'application/json',
      'X-Restli-Protocol-Version': '2.0.0',
    };

    // Step 1: Register upload via /v2/assets (same endpoint as images)
    this.fastify.log.info('LinkedIn video: registering upload');
    const registerRes = await axios.post(
      `${this.apiBaseUrl}/assets?action=registerUpload`,
      {
        registerUploadRequest: {
          owner: `urn:li:person:${accessToken.person_urn}`,
          recipes: ['urn:li:digitalmediaRecipe:feedshare-video'],
          serviceRelationships: [
            { relationshipType: 'OWNER', identifier: 'urn:li:userGeneratedContent' },
          ],
          supportedUploadMechanism: ['SYNCHRONOUS_UPLOAD'],
        },
      },
      { headers: authHeaders }
    );

    const uploadUrl = registerRes.data?.value?.uploadMechanism?.[
      'com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest'
    ]?.uploadUrl;
    const assetUrn = registerRes.data?.value?.asset;

    if (!uploadUrl || !assetUrn) {
      throw new Error('Unexpected response from LinkedIn asset registration for video');
    }

    // Step 2: Upload binary
    this.fastify.log.info(`LinkedIn video: uploading binary (${videoBuffer.length} bytes)`);
    await axios.put(uploadUrl, videoBuffer, {
      headers: {
        Authorization: `Bearer ${accessToken.access_token}`,
        'Content-Type': videoType,
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      timeout: 120000,
    });

    this.fastify.log.info(`LinkedIn video: upload complete, asset=${assetUrn}`);
    return assetUrn; // e.g. urn:li:digitalmediaAsset:...
  }

  // Refresh token
  async refreshAccessToken(refreshToken: string): Promise<any> {
    try {
      const response = await axios.post(
        "https://www.linkedin.com/oauth/v2/accessToken",
        null,
        {
          params: {
            grant_type: "refresh_token",
            refresh_token: refreshToken,
            client_id: this.clientId,
            client_secret: this.clientSecret,
          },
        }
      );
      return response.data;
    } catch (err: any) {
      const error = err as any;
      this.fastify?.log?.error?.('Error refreshing access token:', error.response?.data || error.message);
      throw new Error('Failed to refresh access token');
    }
  }

  // Unified post
  async createUnifiedPost(accessToken: any, content: any): Promise<any> {
    try {
      this.fastify.log.info("Starting unified post creation");

      if (!accessToken?.access_token) {
        throw new Error('Valid access token is required');
      }
      if (!content?.text) {
        throw new Error('Post content text is required');
      }

      const mediaItems = [];

      // Handle video — upload asset then post with VIDEO category
      if (content.video?.buffer) {
        try {
          const assetUrn = await this.uploadVideoToLinkedIn(
            accessToken,
            content.video.buffer,
            content.video.type || 'video/mp4',
          );

          // Ensure personUrn is normalised before building the post
          const personUrn = (accessToken.person_urn || '').replace(/^urn:li:person:/, '');

          const videoPostPayload = {
            author: `urn:li:person:${personUrn}`,
            lifecycleState: 'PUBLISHED',
            specificContent: {
              'com.linkedin.ugc.ShareContent': {
                shareCommentary: { text: content.text },
                shareMediaCategory: 'VIDEO',
                media: [{ status: 'READY', media: assetUrn }],
              },
            },
            visibility: {
              'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC',
            },
          };

          const videoPostRes = await axios.post(`${this.apiBaseUrl}/ugcPosts`, videoPostPayload, {
            headers: {
              Authorization: `Bearer ${accessToken.access_token}`,
              'Content-Type': 'application/json',
              'X-Restli-Protocol-Version': '2.0.0',
            },
            timeout: 15000,
          });
          return videoPostRes.data;
        } catch (videoError: any) {
          this.fastify?.log?.error?.('Error uploading video to LinkedIn:', videoError.message);
          throw new Error(`Failed to upload video: ${videoError.message}`);
        }
      }

      // Handle image — uses /v2/assets (works with w_member_social scope)
      if (content.image?.buffer) {
        try {
          this.fastify.log.info("Registering image upload with LinkedIn");

          // Normalize person_urn to bare ID
          if (!accessToken.person_urn) {
            const profileResponse = await axios.get(`${this.apiBaseUrl}/userinfo`, {
              headers: { Authorization: `Bearer ${accessToken.access_token}` },
            });
            accessToken.person_urn = profileResponse.data.sub;
          } else {
            accessToken.person_urn = accessToken.person_urn.replace(/^urn:li:person:/, '');
          }

          // Step 1: Register upload via /v2/assets
          const registerRes = await axios.post(
            `${this.apiBaseUrl}/assets?action=registerUpload`,
            {
              registerUploadRequest: {
                owner: `urn:li:person:${accessToken.person_urn}`,
                recipes: ['urn:li:digitalmediaRecipe:feedshare-image'],
                serviceRelationships: [
                  { relationshipType: 'OWNER', identifier: 'urn:li:userGeneratedContent' },
                ],
              },
            },
            {
              headers: {
                Authorization: `Bearer ${accessToken.access_token}`,
                'Content-Type': 'application/json',
                'X-Restli-Protocol-Version': '2.0.0',
              },
            }
          );

          const uploadUrl = registerRes.data?.value?.uploadMechanism?.[
            'com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest'
          ]?.uploadUrl;
          const assetUrn = registerRes.data?.value?.asset;

          if (!uploadUrl || !assetUrn) {
            throw new Error('Unexpected response from LinkedIn asset registration');
          }

          this.fastify.log.info(`Uploading image to URL: ${uploadUrl.substring(0, 50)}...`);

          // Step 2: Upload binary
          await axios.put(uploadUrl, content.image.buffer, {
            headers: {
              Authorization: `Bearer ${accessToken.access_token}`,
              'Content-Type': content.image.type,
            },
          });

          this.fastify.log.info('Image upload successful, assetUrn:', assetUrn);
          mediaItems.push({ status: 'READY', media: assetUrn });
        } catch (imageError: any) {
          this.fastify?.log?.error?.('Error uploading image to LinkedIn:', {
            message: imageError.message,
            responseData: imageError.response?.data || null,
            responseStatus: imageError.response?.status || null,
          });
          throw new Error(`Failed to upload image: ${imageError.message}`);
        }
      }

      // Handle link
      if (content.linkUrl) {
        mediaItems.push({ status: 'READY', originalUrl: content.linkUrl });
      }

      // Ensure personUrn — normalize to bare ID
      let personUrn = accessToken.person_urn
        ? accessToken.person_urn.replace(/^urn:li:person:/, '')
        : null;

      if (!personUrn) {
        try {
          const profileResponse = await axios.get(`${this.apiBaseUrl}/userinfo`, {
            headers: { Authorization: `Bearer ${accessToken.access_token}` },
          });
          if (!profileResponse.data.sub) throw new Error('LinkedIn profile sub not found');
          personUrn = profileResponse.data.sub;
        } catch (profileError: any) {
          throw new Error(`Failed to get LinkedIn profile: ${profileError.message}`);
        }
      }

      // Determine shareMediaCategory
      let shareMediaCategory = 'NONE';
      if (mediaItems.length > 0) {
        if (content.image && content.linkUrl) shareMediaCategory = 'MIXED';
        else if (content.image) shareMediaCategory = 'IMAGE';
        else if (content.linkUrl) shareMediaCategory = 'ARTICLE';
      }

      const postPayload = {
        author: `urn:li:person:${personUrn}`,
        lifecycleState: 'PUBLISHED',
        specificContent: {
          'com.linkedin.ugc.ShareContent': {
            shareCommentary: { text: content.text },
            shareMediaCategory,
            ...(mediaItems.length > 0 && { media: mediaItems }),
          },
        },
        visibility: {
          'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC',
        },
      };

      this.fastify.log.info('LinkedIn ugcPosts payload:', {
        author: postPayload.author,
        shareMediaCategory,
        hasMedia: mediaItems.length > 0,
      });

      try {
        const response = await axios.post(`${this.apiBaseUrl}/ugcPosts`, postPayload, {
          headers: {
            Authorization: `Bearer ${accessToken.access_token}`,
            'Content-Type': 'application/json',
            'X-Restli-Protocol-Version': '2.0.0',
          },
          timeout: 15000,
        });

        return response.data;
      } catch (postError: any) {
        if (postError.response) {
          const { status, data } = postError.response;
          this.fastify.log.error(`LinkedIn API error (${status}):`, { data });
          if (status === 401) throw new Error('LinkedIn API authentication failed. Token may be invalid or expired.');
          if (status === 403) throw new Error('LinkedIn API permission denied. Check token permissions.');
          throw new Error(`LinkedIn API error (${status}): ${JSON.stringify(data)}`);
        }
        throw postError;
      }
    } catch (err: any) {
      const error = err as any;
      this.fastify?.log?.error?.('Error in createUnifiedPost:', {
        message: error.message,
        stack: error.stack,
        responseData: error.response?.data || null,
        responseStatus: error.response?.status || null,
        responseHeaders: error.response?.headers || null,
      });

      if (error.response) {
        throw new Error(`LinkedIn API Error (${error.response.status}): ${JSON.stringify(error.response.data)}`);
      } else {
        throw new Error(`Failed to create unified post: ${error.message}`);
      }
    }
  }
}

