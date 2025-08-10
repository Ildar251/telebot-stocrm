import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  telegram_id: { type: Number, index: true, unique: true, required: true },
  contact_id: { type: Number, required: true },
  phone: { type: String, required: true },
}, { timestamps: true, collection: 'tg_links' });

export type LinkDoc = mongoose.InferSchemaType<typeof schema> & { _id: any };

export const LinkModel = mongoose.model('Link', schema);

export async function connectDB(uri: string) {
  if (mongoose.connection.readyState === 1) return;
  await mongoose.connect(uri);
}
