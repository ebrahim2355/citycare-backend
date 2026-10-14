import { StatusCodes } from "http-status-codes";
import multer from "multer";
import AppError from "../errors/AppError";

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const MAX_IMAGES_PER_REQUEST = 2;
export const IMAGE_FIELD = "images";

const allowedMimeTypes = ["image/jpeg", "image/png", "image/webp"];

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_IMAGE_BYTES, files: MAX_IMAGES_PER_REQUEST },
    fileFilter: (_req, file, callback) => {
        if (!allowedMimeTypes.includes(file.mimetype)) {
            callback(
                new AppError(StatusCodes.BAD_REQUEST, "Invalid file type", [
                    { field: IMAGE_FIELD, message: "Only JPG, PNG and WEBP images are allowed" },
                ])
            );
            return;
        }

        callback(null, true);
    },
});

export const uploadImages = upload.array(IMAGE_FIELD, MAX_IMAGES_PER_REQUEST);

export const detectImageType = (buffer: Buffer): "jpg" | "png" | "webp" | null => {
    if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
        return "jpg";
    }

    if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
        return "png";
    }

    if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
        return "webp";
    }

    return null;
};
