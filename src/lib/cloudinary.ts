import { v2 as cloudinary, type UploadApiResponse } from "cloudinary";
import { StatusCodes } from "http-status-codes";
import config from "../config";
import AppError from "../errors/AppError";

const { url, cloudName, apiKey, apiSecret } = config.cloudinary;
const hasSeparateKeys = Boolean(cloudName && apiKey && apiSecret);

if (hasSeparateKeys) {
    cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret, secure: true });
}

export const isUploadConfigured = hasSeparateKeys || Boolean(url);

export const ensureUploadConfigured = () => {
    if (!isUploadConfigured) {
        throw new AppError(
            StatusCodes.SERVICE_UNAVAILABLE,
            "Image upload is not configured",
            "The Cloudinary keys are missing on the server"
        );
    }
};

export const uploadImage = (buffer: Buffer, folder: string) => {
    return new Promise<UploadApiResponse>((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream({ folder, resource_type: "image", timeout: 20000 }, (error, result) => {
            if (error || !result) {
                reject(
                    new AppError(StatusCodes.BAD_GATEWAY, "Image upload failed", error?.message ?? "Cloudinary did not accept the image")
                );
                return;
            }

            resolve(result);
        });

        stream.end(buffer);
    });
};

export const deleteImage = async (publicId: string) => {
    try {
        await cloudinary.uploader.destroy(publicId, { resource_type: "image" });
    } catch (error) {
        console.error(`Could not delete image ${publicId}: ${error instanceof Error ? error.message : "unknown error"}`);
    }
};
