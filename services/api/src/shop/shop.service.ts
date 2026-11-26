import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { ChargerLead, ChargerProduct, Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

export const SITE_TYPES = ["Home", "Apartment", "Office", "Shop", "Highway", "Fleet depot", "Bus depot", "Other"] as const;
export const LEAD_STATUSES = ["NEW", "CONTACTED", "QUOTED", "WON", "LOST"] as const;

export interface ProductFilter {
  current?: string;
  minKw?: string;
  maxKw?: string;
}

export interface LeadInput {
  productId?: string | null;
  name?: string;
  phone?: string;
  city?: string;
  siteType?: string;
  quantity?: number;
  notes?: string | null;
}

export interface ProductInput {
  name?: string;
  brand?: string;
  current?: string;
  powerKw?: number;
  connectors?: string[];
  priceInr?: number | null;
  warrantyYears?: number;
  installationIncluded?: boolean;
  suitedFor?: string[];
  summary?: string;
  specs?: Record<string, string> | null;
  active?: boolean;
  isSample?: boolean;
  sortOrder?: number;
}

const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export function productView(p: ChargerProduct) {
  return {
    id: p.id,
    name: p.name,
    brand: p.brand,
    current: p.current,
    powerKw: Number(p.powerKw),
    connectors: p.connectors,
    priceInr: p.priceInr,
    warrantyYears: p.warrantyYears,
    installationIncluded: p.installationIncluded,
    suitedFor: p.suitedFor,
    summary: p.summary,
    specs: (p.specs as Record<string, string> | null) ?? {},
    isSample: p.isSample,
    active: p.active,
  };
}

export function leadView(l: ChargerLead & { product?: ChargerProduct | null }) {
  return {
    id: l.id,
    productId: l.productId,
    productName: l.product?.name ?? null,
    name: l.name,
    phone: l.phone,
    city: l.city,
    siteType: l.siteType,
    quantity: l.quantity,
    notes: l.notes,
    status: l.status,
    createdAt: l.createdAt.toISOString(),
  };
}

/** "Want a charger?": a catalogue of AC and DC chargers, and quote requests (enquiry only, no online purchase yet). */
@Injectable()
export class ShopService {
  constructor(private readonly db: PrismaService) {}

  async list(f: ProductFilter, includeInactive = false) {
    const where: Prisma.ChargerProductWhereInput = includeInactive ? {} : { active: true };
    if (f.current) {
      const c = f.current.toUpperCase();
      if (c !== "AC" && c !== "DC") throw new BadRequestException("current must be AC or DC");
      where.current = c;
    }
    const kw: Prisma.DecimalFilter = {};
    if (f.minKw) kw.gte = this.kw(f.minKw);
    if (f.maxKw) kw.lte = this.kw(f.maxKw);
    if (kw.gte !== undefined || kw.lte !== undefined) where.powerKw = kw;
    const rows = await this.db.chargerProduct.findMany({ where, orderBy: [{ current: "asc" }, { powerKw: "asc" }, { sortOrder: "asc" }] });
    return rows.map(productView);
  }

  async get(id: string, includeInactive = false) {
    const p = await this.db.chargerProduct.findUnique({ where: { id } });
    if (!p || (!p.active && !includeInactive)) throw new NotFoundException("Charger not found");
    return productView(p);
  }

  async createLead(userId: string, body: LeadInput) {
    const name = text(body?.name, 80);
    const phone = text(body?.phone, 20).replace(/[\s-]/g, "").replace(/^\+?91/, "");
    const city = text(body?.city, 80);
    const siteType = text(body?.siteType, 40);
    const quantity = body?.quantity ?? 1;
    if (name.length < 2) throw new BadRequestException("Enter your name");
    if (!/^[6-9]\d{9}$/.test(phone)) throw new BadRequestException("Enter a 10-digit mobile number");
    if (city.length < 2) throw new BadRequestException("Enter your city or town");
    if (!(SITE_TYPES as readonly string[]).includes(siteType)) throw new BadRequestException(`Site type must be one of: ${SITE_TYPES.join(", ")}`);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 500) throw new BadRequestException("Quantity must be between 1 and 500");
    let productId: string | null = null;
    if (body?.productId) {
      const p = await this.db.chargerProduct.findUnique({ where: { id: body.productId } });
      if (!p || !p.active) throw new NotFoundException("Charger not found");
      productId = p.id;
    }
    const lead = await this.db.chargerLead.create({
      data: { userId, productId, name, phone, city, siteType, quantity, notes: text(body?.notes, 1000) || null },
      include: { product: true },
    });
    return leadView(lead);
  }

  async myLeads(userId: string) {
    const rows = await this.db.chargerLead.findMany({ where: { userId }, include: { product: true }, orderBy: { createdAt: "desc" }, take: 50 });
    return rows.map(leadView);
  }

  // --- Operator console ---

  async leads(status?: string) {
    const where = status ? { status: this.status(status) } : {};
    const rows = await this.db.chargerLead.findMany({ where, include: { product: true }, orderBy: { createdAt: "desc" }, take: 200 });
    return rows.map(leadView);
  }

  async setLeadStatus(id: string, status: string) {
    const lead = await this.db.chargerLead.findUnique({ where: { id } });
    if (!lead) throw new NotFoundException("Enquiry not found");
    const updated = await this.db.chargerLead.update({ where: { id }, data: { status: this.status(status) }, include: { product: true } });
    return leadView(updated);
  }

  async createProduct(body: ProductInput) {
    const data = this.productData(body, true) as Prisma.ChargerProductCreateInput;
    return productView(await this.db.chargerProduct.create({ data }));
  }

  async updateProduct(id: string, body: ProductInput) {
    await this.get(id, true);
    const data = this.productData(body, false);
    return productView(await this.db.chargerProduct.update({ where: { id }, data }));
  }

  private productData(b: ProductInput, creating: boolean): Prisma.ChargerProductUpdateInput {
    const d: Prisma.ChargerProductUpdateInput = {};
    const need = (field: string) => creating && (b as Record<string, unknown>)?.[field] === undefined;
    for (const f of ["name", "current", "powerKw", "summary"]) if (need(f)) throw new BadRequestException(`${f} is required`);
    if (b.name !== undefined) {
      const n = text(b.name, 80);
      if (n.length < 2) throw new BadRequestException("Enter a product name");
      d.name = n;
    }
    if (b.brand !== undefined) d.brand = text(b.brand, 80);
    if (b.current !== undefined) {
      if (b.current !== "AC" && b.current !== "DC") throw new BadRequestException("current must be AC or DC");
      d.current = b.current;
    }
    if (b.powerKw !== undefined) {
      if (typeof b.powerKw !== "number" || !(b.powerKw > 0 && b.powerKw <= 1000)) throw new BadRequestException("Power must be between 0 and 1000 kW");
      d.powerKw = b.powerKw;
    }
    if (b.connectors !== undefined) d.connectors = this.list_(b.connectors, "connectors");
    if (b.suitedFor !== undefined) d.suitedFor = this.list_(b.suitedFor, "suitedFor");
    if (b.priceInr !== undefined) {
      if (b.priceInr !== null && (!Number.isInteger(b.priceInr) || b.priceInr < 0)) throw new BadRequestException("Price must be whole rupees, or empty for 'ask for quote'");
      d.priceInr = b.priceInr;
    }
    if (b.warrantyYears !== undefined) {
      if (!Number.isInteger(b.warrantyYears) || b.warrantyYears < 0 || b.warrantyYears > 15) throw new BadRequestException("Warranty must be 0 to 15 years");
      d.warrantyYears = b.warrantyYears;
    }
    if (b.summary !== undefined) d.summary = text(b.summary, 500);
    if (b.specs !== undefined) {
      if (b.specs !== null && (typeof b.specs !== "object" || Array.isArray(b.specs))) throw new BadRequestException("specs must be name: value pairs");
      const specs: Record<string, string> = {};
      for (const [k, v] of Object.entries(b.specs ?? {})) if (text(k, 60)) specs[text(k, 60)] = text(String(v), 200);
      d.specs = specs;
    }
    for (const f of ["installationIncluded", "active", "isSample"] as const) {
      if (b[f] !== undefined) {
        if (typeof b[f] !== "boolean") throw new BadRequestException(`${f} must be true or false`);
        d[f] = b[f];
      }
    }
    if (b.sortOrder !== undefined && Number.isInteger(b.sortOrder)) d.sortOrder = b.sortOrder;
    return d;
  }

  private list_(v: unknown, field: string): string[] {
    if (!Array.isArray(v)) throw new BadRequestException(`${field} must be a list`);
    return v.map((x) => text(x, 60)).filter(Boolean).slice(0, 10);
  }

  private kw(v: string) {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) throw new BadRequestException("kW filter must be a number");
    return n;
  }

  private status(s: string) {
    const u = s.toUpperCase();
    if (!(LEAD_STATUSES as readonly string[]).includes(u)) throw new BadRequestException(`Status must be one of: ${LEAD_STATUSES.join(", ")}`);
    return u;
  }
}
