import app from "./app";
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import OAuthProvider from "@cloudflare/workers-oauth-provider";
import axios from "axios";
import * as uuid from "uuid"; // Ensure uuid is installed and marked as external
import * as cheerio from "cheerio"; // Ensure cheerio is installed and marked as external

// Load API key from environment variable or use the provided key
const CLOUDFLARE_API_KEY = process.env.CLOUDFLARE_API_KEY || "e6724152b4e4113929c4baca8b9585a3e5d95";
const CLOUDFLARE_EMAIL = process.env.CLOUDFLARE_EMAIL || "rondweb@gmail.com";
const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || "6760bc62386c6b7df606414571f8164c";
const R2_URL = "https://pub-3bf40eb073024dc2846e1518b851c583.r2.dev"

/**
 * Implementation of an MCP (Multi-agent Communication Protocol) server with various AI-powered tools.
 * 
 * @class
 * @extends McpAgent
 * 
 * @example
 * const myMcpServer = new MyMCP();
 * await myMcpServer.init();
 */
export class MyMCP extends McpAgent {
    server = new McpServer({
        name: "TextSummarizationAndScrapping",
        version: "1.0.0",
    });

	/**
	 * Initializes the server by registering available tools.
	 * 
	 * This method sets up the following tools:
	 * - `fetchAudioAndSave`: Converts text to speech using Cloudflare's MeloTTS API and returns
	 *   the audio as base64 data along with a generated UUID.
	 * - `summarizeText`: Summarizes provided text using Cloudflare's BART-large-CNN model,
	 *   limiting the output to 100 tokens.
	 * - `scrapeUrlAndSublinks`: Retrieves content from a specified URL and up to 5 sublinks,
	 *   returning the scraped text content as a structured JSON resource.
	 * 
	 * Each tool is registered with proper input validation using Zod schemas and
	 * includes error handling for API failures or unexpected responses.
	 * 
	 * @returns {Promise<void>} A promise that resolves when all tools are registered
	 */
	/**
	 * Initializes the server with custom tools for text-to-speech, text summarization, web scraping, and file uploads.
	 * 
	 * Sets up the following tools:
	 * - `fetchAudioAndSave`: Converts text to speech using Cloudflare's MeloTTS API and returns the 
	 *   audio as base64 along with a generated UUID. Supports different languages via the lang parameter.
	 * 
	 * - `summarizeText`: Generates a summary of provided text using Cloudflare's BART-large-CNN model.
	 *   Limits output to 100 tokens.
	 * 
	 * - `scrapeUrlAndSublinks`: Fetches the content of a specified URL and extracts up to 5 sublinks.
	 *   For each sublink, also retrieves its content. Returns JSON with the main URL content and sublink contents.
	 * 
	 * - `uploadAudioToR2`: Uploads audio files (base64) to Cloudflare R2 storage and returns the public URL.
	 *   Accepts optional fileName and contentType parameters.
	 * 
	 * @async
	 * @returns {Promise<void>} A promise that resolves when all tools are registered
	 * @throws Will log errors that occur during tool registration or execution
	 */
    async init() {
        // Modify fetchAudioAndSave to return base64 audio instead of saving to file
        this.server.tool(
            "fetchAudioAndSave",
            { text: z.string().optional(), lang: z.string().optional() },
            async ({ text = "", lang = "en" }) => {
                try {
                    const key = CLOUDFLARE_API_KEY;
                    const apiUrl = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/ai/run/@cf/myshell-ai/melotts`;

                    const payload = { prompt: text, lang: lang };
                    const headers = {
                        "Content-Type": "application/json",
                        "X-Auth-Email": CLOUDFLARE_EMAIL,
                        "X-Auth-Key": key,
                    };

                    const response = await axios.post(apiUrl, payload, { headers });

                    if (response.status === 200) {
                        const audioBase64 = response.data?.result?.audio;
                        if (audioBase64) {
                            // Generate a unique ID for the audio
                            const audioId = uuid.v4();
                            
                            // Return the audio as base64 and its ID instead of saving to filesystem
                            return { 
                                content: [
                                    { 
                                        type: "text", 
                                        text: `Generated audio ID: ${audioId}` 
                                    },
                                    {
                                        type: "resource",
                                        resource: {
                                            uri: `data:audio/mp3;base64,${audioBase64}`,
                                            blob: audioBase64,
                                            mimeType: "audio/mp3"
                                        }
                                    }
                                ] 
                            };
                        } else {
                            throw new Error("Audio data not found in the response.");
                        }
                    } else {
                        throw new Error(`Request failed: ${response.status} - ${response.statusText}`);
                    }
                } catch (error) {
                    console.error("Error in fetchAudioAndSave:", (error as any).response?.data || (error as Error).message);
                    return { 
                        content: [{ 
                            type: "text", 
                            text: `Error: ${(error as any).response?.data?.errors?.[0]?.message || (error as Error).message}` 
                        }] 
                    };
                }
            }
        );

        // Adding summarizeText as a tool
        this.server.tool(
            "summarizeText",
            { text: z.string() },
            async ({ text }) => {
                try {
                    const apiUrl = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/ai/run/@cf/facebook/bart-large-cnn`;

                    // Try with input_text instead of text
                    const payload = { 
                        input_text: text,
                        max_tokens: 100
                    };
                    
                    const headers = {
                        "Content-Type": "application/json",
                        "X-Auth-Email": CLOUDFLARE_EMAIL,
                        "X-Auth-Key": CLOUDFLARE_API_KEY,
                    };

                    console.log("Sending summarize request with payload:", JSON.stringify(payload));
                    const response = await axios.post(apiUrl, payload, { headers });

                    if (response.status === 200) {
                        console.log("Summarize response:", JSON.stringify(response.data));
                        const summary = response.data?.result?.summary;
                        if (summary) {
                            return { content: [{ type: "text", text: summary }] };
                        } else {
                            throw new Error("Summary data not found in the response.");
                        }
                    } else {
                        throw new Error(`Request failed: ${response.status} - ${response.statusText}`);
                    }
                } catch (error) {
                    console.error("Error in summarizeText:", (error as any).response?.data || (error as Error).message);
                    return { 
                        content: [{ 
                            type: "text", 
                            text: `Error: ${(error as any).response?.data?.errors?.[0]?.message || (error as Error).message}` 
                        }] 
                    };
                }
            }
        );

        // Adding scrapeUrlAndSublinks as a tool
        this.server.tool(
            "scrapeUrlAndSublinks",
            { url: z.string() },
            async ({ url }, extra) => {
                try {
                    const response = await axios.get(url);
                    const $ = cheerio.load(response.data);

                    const mainText = $("body").text().trim();

                    const sublinks = $("a[href]").slice(0, 5).map((_, el) => $(el).attr("href")).get();

                    const sublinkTexts: { [key: string]: string } = {};
                    for (const sublink of sublinks) {
                        const sublinkUrl = new URL(sublink, url).toString();
                        try {
                            const subResponse = await axios.get(sublinkUrl);
                            const subPage = cheerio.load(subResponse.data);
                            sublinkTexts[sublinkUrl] = subPage("body").text().trim();
                        } catch (error) {
                            sublinkTexts[sublinkUrl] = `Error fetching sublink: ${(error as Error).message}`;
                        }
                    }

                    return {
                        content: [
                            {
                                type: "resource",
                                resource: {
                                    text: JSON.stringify({ main_url: url, main_text: mainText, sublinks: sublinkTexts }),
                                    uri: url,
                                },
                            },
                        ],
                    };
                } catch (error) {
                    return { content: [{ type: "text", text: `Error: ${(error as Error).message}` }] };
                }
            }
        );

        // Adding uploadAudioToR2 as a tool
        this.server.tool(
            "uploadAudioToR2",
            { 
                audioData: z.string(), 
                fileName: z.string().optional(),
                contentType: z.string().optional() 
            },
            async ({ audioData, fileName, contentType = "audio/mp3" }) => {
                try {
                    // Generate a unique filename if not provided
                    const finalFileName = fileName || `audio-${uuid.v4()}.mp3`;
                    
                    // Convert base64 to buffer
                    const audioBuffer = Buffer.from(audioData, 'base64');
                    
                    // Construct the R2 API endpoint for uploading
                    const bucketName = "uploads";
                    const uploadUrl = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/r2/buckets/${bucketName}/objects/${finalFileName}`;
                    
                    const headers = {
                        "Content-Type": contentType,
                        "X-Auth-Email": CLOUDFLARE_EMAIL,
                        "X-Auth-Key": CLOUDFLARE_API_KEY,
                        "Content-Length": audioBuffer.length.toString(),
                    };

                    console.log(`Uploading audio to R2: ${finalFileName}`);
                    const response = await axios.put(uploadUrl, audioBuffer, { headers });

                    if (response.status === 200 || response.status === 201) {
                        const fileUrl = `${R2_URL}/${finalFileName}`;
                        
                        return { 
                            content: [
                                { 
                                    type: "text", 
                                    text: `Audio file successfully uploaded to R2 storage.\nFile: ${finalFileName}\nURL: ${fileUrl}` 
                                },
                                {
                                    type: "resource",
                                    resource: {
                                        uri: fileUrl,
                                        blob: audioData,
                                        mimeType: contentType
                                    }
                                }
                            ] 
                        };
                    } else {
                        throw new Error(`Upload failed: ${response.status} - ${response.statusText}`);
                    }
                } catch (error) {
                    console.error("Error in uploadAudioToR2:", (error as any).response?.data || (error as Error).message);
                    return { 
                        content: [{ 
                            type: "text", 
                            text: `Error uploading to R2: ${(error as any).response?.data?.errors?.[0]?.message || (error as Error).message}` 
                        }] 
                    };
                }
            }
        );
    }
}

// Export the OAuth handler as the default
export default new OAuthProvider({
    apiRoute: "/sse",
    // Return to the original mounting method that was working
    // @ts-ignore
    apiHandler: MyMCP.mount("/sse"),
    // @ts-ignore
    defaultHandler: app,
    authorizeEndpoint: "/authorize",
    tokenEndpoint: "/token",
    clientRegistrationEndpoint: "/register",
});