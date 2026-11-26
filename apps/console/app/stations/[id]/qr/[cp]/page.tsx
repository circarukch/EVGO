import QRCode from "qrcode";
import { notFound } from "next/navigation";
import { adminFetch, orNull } from "../../../../../lib/api";
import { PrintButton } from "./print-button";

export const dynamic = "force-dynamic";

type Codes = { station: string; chargePointId: string; codes: { connectorId: number; payload: string; printedCode: string; label: string }[] };

/** One sticker per plug. The app scans EVGO:<charger>:<plug>; the printed code is for typing in when the camera fails. */
export default async function QrSheet({ params }: { params: Promise<{ id: string; cp: string }> }) {
  const { cp } = await params;
  const res = await adminFetch(`/admin/chargers/${encodeURIComponent(decodeURIComponent(cp))}/qr`).catch(orNull);
  if (!res?.ok) notFound();
  const data: Codes = await res.json();
  const svgs = await Promise.all(data.codes.map((c) => QRCode.toString(c.payload, { type: "svg", errorCorrectionLevel: "M", margin: 1, width: 240 })));
  return (
    <main className="qr-sheet">
      <div className="no-print">
        <h1>QR codes for {data.chargePointId}</h1>
        <p className="hint">Print and stick each code next to its plug. Laminate them if the charger is outdoors.</p>
        <PrintButton />
      </div>
      <div className="stickers">
        {data.codes.map((c, i) => (
          <div key={c.connectorId} className="sticker">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/evgo-logo.png" alt="EVGO" width={96} height={27} />
            <p className="scan">Scan to charge</p>
            <div className="qr" dangerouslySetInnerHTML={{ __html: svgs[i] }} />
            <p className="plugname">Plug {c.connectorId} · {c.label}</p>
            <p className="code">{c.printedCode}</p>
            <p className="where">{data.station}</p>
          </div>
        ))}
      </div>
    </main>
  );
}
