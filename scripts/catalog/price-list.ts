/**
 * The Dental Hub price list, as supplied by the business, in EGP.
 *
 * Names follow the product catalogue (CATALOGUE DENTAL HUB). A null price
 * means the model is in the catalogue but has no list price yet: the rep types
 * the price on each quotation until one is set in Settings -> Products.
 *
 * `npm run catalog:import` adds the rows that are missing and leaves existing
 * ones untouched, so prices edited in the app are never overwritten.
 */
import type { ProductImportRow } from '@/server/crm/catalog/repository';

export const PRICE_LIST: ProductImportRow[] = [
  // ROSON dental units
  { categoryCode: 'dental_units', brand: 'ROSON', name: 'R1 Dental Unit', listPrice: 95_000 },
  { categoryCode: 'dental_units', brand: 'ROSON', name: 'R2 Pro Dental Unit', listPrice: 118_000 },
  { categoryCode: 'dental_units', brand: 'ROSON', name: 'A3S Standard Dental Unit', listPrice: 155_000 },
  { categoryCode: 'dental_units', brand: 'ROSON', name: 'A3S Top Mounted Dental Unit', listPrice: 165_000 },
  { categoryCode: 'dental_units', brand: 'ROSON', name: 'S6 Dental Unit', listPrice: 170_000 },
  { categoryCode: 'dental_units', brand: 'ROSON', name: 'A1 Pro Dental Unit', listPrice: 210_000 },

  // Toye dental units
  { categoryCode: 'dental_units', brand: 'Toye', name: 'TY-E1 Dental Unit', listPrice: 88_000 },
  { categoryCode: 'dental_units', brand: 'Toye', name: 'TY-830 Dental Unit', listPrice: 160_000 },

  // Fomos sterilization and small equipment
  { categoryCode: 'autoclaves', brand: 'Fomos', name: 'Autoclave 18L Class B (Foster Plus)', listPrice: 70_000 },
  { categoryCode: 'autoclaves', brand: 'Fomos', name: 'Autoclave 23L Class B (Foster Plus)', listPrice: 75_000 },
  { categoryCode: 'autoclaves', brand: 'Fomos', name: 'Autoclave 18L Class N', listPrice: 32_000 },
  { categoryCode: 'sterilization', brand: 'Fomos', name: 'Sealing Machine Foseal-02', listPrice: 5_500 },
  { categoryCode: 'sterilization', brand: 'Fomos', name: 'Sealing Machine Foseal', listPrice: 6_500 },
  { categoryCode: 'sterilization', brand: 'Fomos', name: 'Ultrasonic Cleaner', listPrice: 5_500 },
  { categoryCode: 'sterilization', brand: 'Fomos', name: 'Water Distiller Aqua', listPrice: null },
  { categoryCode: 'other_equipment', brand: 'Fomos', name: 'Amalgamator iMix', listPrice: 4_200 },

  // X-Smile
  { categoryCode: 'intraoral_cameras', brand: 'X-Smile', name: 'MLG Intraoral Camera', listPrice: 10_000 },
  { categoryCode: 'intraoral_cameras', brand: 'X-Smile', name: 'Pro All in One', listPrice: 33_000 },
  { categoryCode: 'whitening', brand: 'X-Smile', name: 'Bleaching Light', listPrice: 13_000 },

  // Mecco
  { categoryCode: 'curing_lights', brand: 'Mecco', name: 'Q8 Pro Curing Light', listPrice: 5_000 },
  { categoryCode: 'curing_lights', brand: 'Mecco', name: 'Q6 Curing Light', listPrice: 3_000 },
  { categoryCode: 'curing_lights', brand: 'Mecco', name: 'Q5 Curing Light', listPrice: 2_000 },
  { categoryCode: 'curing_lights', brand: 'Mecco', name: 'i-Cure Curing Light', listPrice: null },
  { categoryCode: 'curing_lights', brand: 'Mecco', name: 'i-Cure Pro Curing Light', listPrice: null },
  { categoryCode: 'endodontics', brand: 'Mecco', name: 'Endo Mini', listPrice: null },
  { categoryCode: 'endodontics', brand: 'Mecco', name: 'R7 Apex Locator', listPrice: null },
];
