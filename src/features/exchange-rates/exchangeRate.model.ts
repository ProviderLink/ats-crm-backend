import { Document, model, Schema } from 'mongoose';

/** One row per currency pair, overwritten on each refresh. */
export interface IExchangeRateDocument extends Document {
  pair: string;
  rate: number;
  /** The provider's publication date (YYYY-MM-DD). */
  rateDate: string;
  fetchedAt: Date;
}

const exchangeRateSchema = new Schema<IExchangeRateDocument>(
  {
    pair: { type: String, required: true, unique: true },
    rate: { type: Number, required: true },
    rateDate: { type: String, required: true },
    fetchedAt: { type: Date, required: true },
  },
  { timestamps: true }
);

export default model<IExchangeRateDocument>('ExchangeRate', exchangeRateSchema);
