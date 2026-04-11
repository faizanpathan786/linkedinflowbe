"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const axios_1 = __importDefault(require("axios"));
class LinkedInService {
    constructor(fastify) {
        var _a, _b, _c;
        this.fastify = fastify;
        this.clientId = process.env.LINKEDIN_CLIENT_ID;
        this.clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
        this.redirectUri = process.env.LINKEDIN_REDIRECT_URI;
        this.apiBaseUrl = "https://api.linkedin.com/v2";
        this.scope = "openid profile email w_member_social";
        // Set default axios timeouts for LinkedIn API requests
        this.axiosConfig = {
            timeout: 10000, // 10 second timeout
            headers: {
                'X-Restli-Protocol-Version': '2.0.0',
                'LinkedIn-Version': '202501',
            },
        };
        // Log configuration for debugging
        (_c = (_b = (_a = this.fastify) === null || _a === void 0 ? void 0 : _a.log) === null || _b === void 0 ? void 0 : _b.info) === null || _c === void 0 ? void 0 : _c.call(_b, 'LinkedIn service initialized', {
            hasClientId: !!this.clientId,
            hasClientSecret: !!this.clientSecret,
            hasRedirectUri: !!this.redirectUri,
        });
    }
    // Generate LinkedIn OAuth URL
    getAuthUrl(state = '') {
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
    getAccessToken(code) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c, _d, _e, _f;
            try {
                const response = yield axios_1.default.post('https://www.linkedin.com/oauth/v2/accessToken', new URLSearchParams({
                    grant_type: 'authorization_code',
                    code,
                    client_id: this.clientId || '',
                    client_secret: this.clientSecret || '',
                    redirect_uri: this.redirectUri || '',
                }).toString(), {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                    },
                });
                return response.data;
            }
            catch (err) {
                const error = err;
                (_c = (_b = (_a = this.fastify) === null || _a === void 0 ? void 0 : _a.log) === null || _b === void 0 ? void 0 : _b.error) === null || _c === void 0 ? void 0 : _c.call(_b, 'Error getting access token:', ((_d = error.response) === null || _d === void 0 ? void 0 : _d.data) || error.message);
                throw new Error(((_f = (_e = error.response) === null || _e === void 0 ? void 0 : _e.data) === null || _f === void 0 ? void 0 : _f.error_description) || 'Failed to get access token');
            }
        });
    }
    // Get user profile
    getUserProfile(accessToken) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c, _d;
            try {
                const response = yield axios_1.default.get(`${this.apiBaseUrl}/me`, {
                    headers: { Authorization: `Bearer ${accessToken}` },
                });
                const profileData = response.data;
                return {
                    id: profileData.id,
                    vanity_name: profileData.localizedFirstName,
                    metadata: {
                        firstName: profileData.firstName,
                        lastName: profileData.lastName,
                        localizedFirstName: profileData.localizedFirstName,
                        localizedLastName: profileData.localizedLastName,
                        headline: profileData.headline,
                        localizedHeadline: profileData.localizedHeadline,
                        profilePicture: profileData.profilePicture,
                    },
                };
            }
            catch (err) {
                const error = err;
                (_c = (_b = (_a = this.fastify) === null || _a === void 0 ? void 0 : _a.log) === null || _b === void 0 ? void 0 : _b.error) === null || _c === void 0 ? void 0 : _c.call(_b, 'Error getting user profile:', ((_d = error.response) === null || _d === void 0 ? void 0 : _d.data) || error.message);
                throw new Error('Failed to get user profile');
            }
        });
    }
    // Text post
    createTextPost(accessToken, text) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c, _d;
            try {
                const response = yield axios_1.default.post(`${this.apiBaseUrl}/ugcPosts`, {
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
                }, {
                    headers: {
                        Authorization: `Bearer ${accessToken.access_token}`,
                        "Content-Type": "application/json",
                    },
                });
                return response.data;
            }
            catch (error) {
                const e = error;
                (_c = (_b = (_a = this.fastify) === null || _a === void 0 ? void 0 : _a.log) === null || _b === void 0 ? void 0 : _b.error) === null || _c === void 0 ? void 0 : _c.call(_b, 'Error creating text post:', ((_d = e.response) === null || _d === void 0 ? void 0 : _d.data) || e.message);
                throw new Error('Failed to create text post');
            }
        });
    }
    // Link post
    createLinkPost(accessToken, text, linkUrl) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c, _d;
            try {
                const response = yield axios_1.default.post(`${this.apiBaseUrl}/ugcPosts`, {
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
                }, {
                    headers: {
                        Authorization: `Bearer ${accessToken.access_token}`,
                        "Content-Type": "application/json",
                    },
                });
                return response.data;
            }
            catch (error) {
                const e = error;
                (_c = (_b = (_a = this.fastify) === null || _a === void 0 ? void 0 : _a.log) === null || _b === void 0 ? void 0 : _b.error) === null || _c === void 0 ? void 0 : _c.call(_b, 'Error creating link post:', ((_d = e.response) === null || _d === void 0 ? void 0 : _d.data) || e.message);
                throw new Error('Failed to create link post');
            }
        });
    }
    // Image post
    createImagePost(accessToken, text, imageBuffer, imageType) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c, _d;
            try {
                // Step 1: Register upload
                const registerRes = yield axios_1.default.post(`${this.apiBaseUrl}/assets?action=registerUpload`, {
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
                }, {
                    headers: {
                        Authorization: `Bearer ${accessToken.access_token}`,
                        "Content-Type": "application/json",
                    },
                });
                const uploadUrl = registerRes.data.value.uploadMechanism["com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest"].uploadUrl;
                const assetUrn = registerRes.data.value.asset;
                // Step 2: Upload binary
                yield axios_1.default.put(uploadUrl, imageBuffer, {
                    headers: {
                        Authorization: `Bearer ${accessToken.access_token}`,
                        "Content-Type": imageType,
                    },
                });
                // Step 3: Create post referencing the asset
                const postResponse = yield axios_1.default.post(`${this.apiBaseUrl}/ugcPosts`, {
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
                }, {
                    headers: {
                        Authorization: `Bearer ${accessToken.access_token}`,
                        "Content-Type": "application/json",
                    },
                });
                return postResponse.data;
            }
            catch (error) {
                const e = error;
                (_c = (_b = (_a = this.fastify) === null || _a === void 0 ? void 0 : _a.log) === null || _b === void 0 ? void 0 : _b.error) === null || _c === void 0 ? void 0 : _c.call(_b, 'Error creating image post:', ((_d = e.response) === null || _d === void 0 ? void 0 : _d.data) || e.message);
                throw new Error('Failed to create image post');
            }
        });
    }
    // Refresh token
    refreshAccessToken(refreshToken) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c, _d;
            try {
                const response = yield axios_1.default.post("https://www.linkedin.com/oauth/v2/accessToken", null, {
                    params: {
                        grant_type: "refresh_token",
                        refresh_token: refreshToken,
                        client_id: this.clientId,
                        client_secret: this.clientSecret,
                    },
                });
                return response.data;
            }
            catch (err) {
                const error = err;
                (_c = (_b = (_a = this.fastify) === null || _a === void 0 ? void 0 : _a.log) === null || _b === void 0 ? void 0 : _b.error) === null || _c === void 0 ? void 0 : _c.call(_b, 'Error refreshing access token:', ((_d = error.response) === null || _d === void 0 ? void 0 : _d.data) || error.message);
                throw new Error('Failed to refresh access token');
            }
        });
    }
    // Unified post
    createUnifiedPost(accessToken, content) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t;
            try {
                this.fastify.log.info("Starting unified post creation");
                if (!(accessToken === null || accessToken === void 0 ? void 0 : accessToken.access_token)) {
                    throw new Error('Valid access token is required');
                }
                if (!(content === null || content === void 0 ? void 0 : content.text)) {
                    throw new Error('Post content text is required');
                }
                const mediaItems = [];
                // Handle image — uses /v2/assets (works with w_member_social scope)
                if ((_a = content.image) === null || _a === void 0 ? void 0 : _a.buffer) {
                    try {
                        this.fastify.log.info("Registering image upload with LinkedIn");
                        // Normalize person_urn to bare ID
                        if (!accessToken.person_urn) {
                            const profileResponse = yield axios_1.default.get(`${this.apiBaseUrl}/userinfo`, {
                                headers: { Authorization: `Bearer ${accessToken.access_token}` },
                            });
                            accessToken.person_urn = profileResponse.data.sub;
                        }
                        else {
                            accessToken.person_urn = accessToken.person_urn.replace(/^urn:li:person:/, '');
                        }
                        // Step 1: Register upload via /v2/assets
                        const registerRes = yield axios_1.default.post(`${this.apiBaseUrl}/assets?action=registerUpload`, {
                            registerUploadRequest: {
                                owner: `urn:li:person:${accessToken.person_urn}`,
                                recipes: ['urn:li:digitalmediaRecipe:feedshare-image'],
                                serviceRelationships: [
                                    { relationshipType: 'OWNER', identifier: 'urn:li:userGeneratedContent' },
                                ],
                            },
                        }, {
                            headers: {
                                Authorization: `Bearer ${accessToken.access_token}`,
                                'Content-Type': 'application/json',
                                'X-Restli-Protocol-Version': '2.0.0',
                            },
                        });
                        const uploadUrl = (_e = (_d = (_c = (_b = registerRes.data) === null || _b === void 0 ? void 0 : _b.value) === null || _c === void 0 ? void 0 : _c.uploadMechanism) === null || _d === void 0 ? void 0 : _d['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest']) === null || _e === void 0 ? void 0 : _e.uploadUrl;
                        const assetUrn = (_g = (_f = registerRes.data) === null || _f === void 0 ? void 0 : _f.value) === null || _g === void 0 ? void 0 : _g.asset;
                        if (!uploadUrl || !assetUrn) {
                            throw new Error('Unexpected response from LinkedIn asset registration');
                        }
                        this.fastify.log.info(`Uploading image to URL: ${uploadUrl.substring(0, 50)}...`);
                        // Step 2: Upload binary
                        yield axios_1.default.put(uploadUrl, content.image.buffer, {
                            headers: {
                                Authorization: `Bearer ${accessToken.access_token}`,
                                'Content-Type': content.image.type,
                            },
                        });
                        this.fastify.log.info('Image upload successful, assetUrn:', assetUrn);
                        mediaItems.push({ status: 'READY', media: assetUrn });
                    }
                    catch (imageError) {
                        (_k = (_j = (_h = this.fastify) === null || _h === void 0 ? void 0 : _h.log) === null || _j === void 0 ? void 0 : _j.error) === null || _k === void 0 ? void 0 : _k.call(_j, 'Error uploading image to LinkedIn:', {
                            message: imageError.message,
                            responseData: ((_l = imageError.response) === null || _l === void 0 ? void 0 : _l.data) || null,
                            responseStatus: ((_m = imageError.response) === null || _m === void 0 ? void 0 : _m.status) || null,
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
                        const profileResponse = yield axios_1.default.get(`${this.apiBaseUrl}/userinfo`, {
                            headers: { Authorization: `Bearer ${accessToken.access_token}` },
                        });
                        if (!profileResponse.data.sub)
                            throw new Error('LinkedIn profile sub not found');
                        personUrn = profileResponse.data.sub;
                    }
                    catch (profileError) {
                        throw new Error(`Failed to get LinkedIn profile: ${profileError.message}`);
                    }
                }
                // Determine shareMediaCategory
                let shareMediaCategory = 'NONE';
                if (mediaItems.length > 0) {
                    if (content.image && content.linkUrl)
                        shareMediaCategory = 'MIXED';
                    else if (content.image)
                        shareMediaCategory = 'IMAGE';
                    else if (content.linkUrl)
                        shareMediaCategory = 'ARTICLE';
                }
                const postPayload = {
                    author: `urn:li:person:${personUrn}`,
                    lifecycleState: 'PUBLISHED',
                    specificContent: {
                        'com.linkedin.ugc.ShareContent': Object.assign({ shareCommentary: { text: content.text }, shareMediaCategory }, (mediaItems.length > 0 && { media: mediaItems })),
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
                    const response = yield axios_1.default.post(`${this.apiBaseUrl}/ugcPosts`, postPayload, {
                        headers: {
                            Authorization: `Bearer ${accessToken.access_token}`,
                            'Content-Type': 'application/json',
                            'X-Restli-Protocol-Version': '2.0.0',
                        },
                        timeout: 15000,
                    });
                    return response.data;
                }
                catch (postError) {
                    if (postError.response) {
                        const { status, data } = postError.response;
                        this.fastify.log.error(`LinkedIn API error (${status}):`, { data });
                        if (status === 401)
                            throw new Error('LinkedIn API authentication failed. Token may be invalid or expired.');
                        if (status === 403)
                            throw new Error('LinkedIn API permission denied. Check token permissions.');
                        throw new Error(`LinkedIn API error (${status}): ${JSON.stringify(data)}`);
                    }
                    throw postError;
                }
            }
            catch (err) {
                const error = err;
                (_q = (_p = (_o = this.fastify) === null || _o === void 0 ? void 0 : _o.log) === null || _p === void 0 ? void 0 : _p.error) === null || _q === void 0 ? void 0 : _q.call(_p, 'Error in createUnifiedPost:', {
                    message: error.message,
                    stack: error.stack,
                    responseData: ((_r = error.response) === null || _r === void 0 ? void 0 : _r.data) || null,
                    responseStatus: ((_s = error.response) === null || _s === void 0 ? void 0 : _s.status) || null,
                    responseHeaders: ((_t = error.response) === null || _t === void 0 ? void 0 : _t.headers) || null,
                });
                if (error.response) {
                    throw new Error(`LinkedIn API Error (${error.response.status}): ${JSON.stringify(error.response.data)}`);
                }
                else {
                    throw new Error(`Failed to create unified post: ${error.message}`);
                }
            }
        });
    }
}
exports.default = LinkedInService;
