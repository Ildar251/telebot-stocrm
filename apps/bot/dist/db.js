"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LinkModel = void 0;
exports.connectDB = connectDB;
const mongoose_1 = __importDefault(require("mongoose"));
const schema = new mongoose_1.default.Schema({
    telegram_id: { type: Number, index: true, unique: true, required: true },
    contact_id: { type: Number, required: true },
    phone: { type: String, required: true },
}, { timestamps: true, collection: 'tg_links' });
exports.LinkModel = mongoose_1.default.model('Link', schema);
async function connectDB(uri) {
    if (mongoose_1.default.connection.readyState === 1)
        return;
    await mongoose_1.default.connect(uri);
}
