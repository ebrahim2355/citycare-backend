import bcrypt from "bcryptjs";
import config from "../config";

export const hashPassword = (password: string) => bcrypt.hash(password, config.saltRounds);

export const comparePassword = (password: string, hash: string) => bcrypt.compare(password, hash);
