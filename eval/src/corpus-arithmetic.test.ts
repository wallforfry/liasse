import { beforeAll, describe, expect, it } from 'vitest';
import { loadCorpus } from './corpus.ts';
import type { Corpus, GroundTruth } from './schema/index.ts';

let corpus: Corpus;

beforeAll(async () => {
  corpus = await loadCorpus();
});

const linesOf = (document: GroundTruth): readonly string[] =>
  document.pages.flatMap(({ text }) => text.split('\n'));

// The last amount a line prints, whatever its convention: "1 284,00", "1,249.00", "57,30".
const lastAmount = (line: string): number | undefined => {
  const written = line.match(/\d+(?:[ ,.]\d{3})*(?:[,.]\d{2})?/g)?.at(-1);
  if (written === undefined) return undefined;
  const decimals = /[,.](\d{2})$/.exec(written);
  const whole = Number(written.replace(/\D/g, ''));
  return decimals === null ? whole : whole / 100;
};

// The amount of the first line that carries the label; a label the document does not
// print counts for nothing when it is optional.
const amountAt = (document: GroundTruth, label: string, optional = false): number => {
  const line = linesOf(document).find((candidate) => candidate.includes(label));
  const amount = line === undefined ? undefined : lastAmount(line);
  if (amount !== undefined) return amount;
  if (optional) return 0;
  throw new Error(`${document.id} prints no amount for "${label}"`);
};

type Term = readonly [sign: 1 | -1, label: string, optional?: boolean];

interface Equation {
  // The documents it holds for: a type category or document ids.
  readonly of: { readonly type: string } | { readonly ids: readonly string[] };
  readonly result: string;
  readonly terms: readonly Term[];
}

// prettier-ignore
const EQUATIONS: readonly Equation[] = [
  { of: { type: 'energy_bill' }, result: 'Montant total TTC', terms: [[1, 'Abonnement ('], [1, 'Consommation :'], [1, 'Taxes et contributions']] },
  { of: { type: 'water_bill' }, result: 'Montant total TTC', terms: [[1, 'Abonnement semestriel'], [1, 'Eau potable'], [1, 'Assainissement'], [1, 'Redevances et TVA']] },
  { of: { type: 'mobile_bill' }, result: 'Total TTC à payer', terms: [[1, 'Forfait Horizon 60 Go :'], [1, 'Communications hors forfait']] },
  { of: { type: 'internet_bill' }, result: 'Total TTC à payer', terms: [[1, 'Abonnement Fibre Noix'], [1, 'Location de la box']] },
  { of: { type: 'payslip' }, result: 'Salaire brut', terms: [[1, 'Salaire de base'], [1, "Prime de fin d'année", true]] },
  { of: { type: 'payslip' }, result: 'Net à payer avant impôt', terms: [[1, 'Salaire brut'], [-1, 'Cotisations et contributions']] },
  { of: { type: 'payslip' }, result: 'Net payé', terms: [[1, 'Net à payer avant impôt'], [-1, 'Impôt sur le revenu prélevé']] },
  { of: { type: 'vehicle_repair_invoice' }, result: 'Total HT', terms: [[1, 'Révision annuelle'], [1, '2 pneus avant'], [1, 'Montage et équilibrage']] },
  { of: { type: 'vehicle_repair_invoice' }, result: 'Total TTC', terms: [[1, 'Total HT'], [1, 'TVA 20 %']] },
  { of: { type: 'hotel_invoice' }, result: 'Gesamtbetrag:', terms: [[1, 'Doppelzimmer'], [1, 'Frühstück'], [1, 'Kurtaxe']] },
  { of: { type: 'car_rental_invoice' }, result: 'Total (IVA incluido)', terms: [[1, '5 días'], [1, 'Seguro'], [1, 'Combustible']] },
  { of: { ids: ['bike-invoice-2024-08'] }, result: 'Total (export sale', terms: [[1, 'electric bicycle'], [1, 'Delivery to France']] },
  { of: { ids: ['furniture-invoice-1998'] }, result: 'Total TTC', terms: [[1, 'armoire'], [1, 'Livraison et installation']] },
  { of: { type: 'store_receipt' }, result: 'TOTAL', terms: [[1, 'Peinture'], [1, 'Rouleau'], [1, 'Ruban'], [1, 'Enduit']] },
  { of: { type: 'rent_receipt' }, result: 'Total reçu', terms: [[1, 'Loyer :'], [1, 'Provision pour charges']] },
  { of: { type: 'bank_statement' }, result: 'Total des débits', terms: [[1, 'Virement loyer'], [1, 'Prélèvement Telorca'], [1, 'Paiement carte'], [1, 'Prélèvement Fibrenoix'], [1, 'Prélèvement Brisevent'], [1, 'Retrait distributeur']] },
  { of: { type: 'bank_statement' }, result: 'Solde au 31 octobre', terms: [[1, 'Solde au 30 septembre'], [-1, 'Total des débits'], [1, 'Total des crédits']] },
  { of: { type: 'health_reimbursement_statement' }, result: 'Montant des soins', terms: [[1, "l'assurance maladie"], [1, 'Remboursement de la mutuelle'], [1, 'Reste à votre charge']] },
  { of: { type: 'tax_notice' }, result: 'Reste à payer', terms: [[1, 'Impôt sur le revenu net'], [-1, 'Prélèvements à la source']] },
];

const documentsOf = (of: Equation['of']): readonly GroundTruth[] =>
  corpus.documents.filter((document) =>
    'type' in of ? document.type.category === of.type : of.ids.includes(document.id),
  );

const cents = (value: number): number => Math.round(value * 100);

const byId = (id: string): GroundTruth => {
  const found = corpus.documents.find((document) => document.id === id);
  if (found === undefined) throw new Error(`No document ${id}`);
  return found;
};

describe('the figures the documents print', () => {
  it('add up, line by line, to the totals they print', () => {
    const wrong = EQUATIONS.flatMap(({ of, result, terms }) =>
      documentsOf(of).flatMap((document) => {
        const sum = terms.reduce(
          (total, [sign, label, optional]) =>
            total + sign * cents(amountAt(document, label, optional)),
          0,
        );
        const printed = cents(amountAt(document, result));
        return sum === printed
          ? []
          : [`${document.id}: ${result} prints ${String(printed)}, its lines give ${String(sum)}`];
      }),
    );
    expect(wrong).toEqual([]);
  });

  it('cover every document of the types they are written for', () => {
    expect(EQUATIONS.filter(({ of }) => documentsOf(of).length === 0)).toEqual([]);
  });

  it('carry the tax their rate gives', () => {
    const garage = byId('garage-invoice-2025-02');
    const furniture = byId('furniture-invoice-1998');
    const receipt = byId('hardware-receipt-2025-04');
    const hotel = byId('hotel-invoice-2025-07');
    const included = (total: number, rate: number): number => cents(total - total / (1 + rate));
    expect(cents(amountAt(garage, 'TVA 20 %'))).toBe(cents(amountAt(garage, 'Total HT') * 0.2));
    expect(cents(amountAt(furniture, 'dont TVA 20,6 %'))).toBe(
      included(amountAt(furniture, 'Total TTC'), 0.206),
    );
    expect(cents(amountAt(receipt, 'dont TVA 20 %'))).toBe(
      included(amountAt(receipt, 'TOTAL'), 0.2),
    );
    expect(cents(amountAt(hotel, 'enthaltene Mehrwertsteuer'))).toBe(
      included(amountAt(hotel, 'Doppelzimmer'), 0.07) +
        included(amountAt(hotel, 'Frühstück'), 0.19),
    );
  });

  it('convert francs to euros at the fixed rate', () => {
    const furniture = byId('furniture-invoice-1998');
    expect(cents(amountAt(furniture, 'titre indicatif'))).toBe(
      cents(amountAt(furniture, 'Total TTC') / 6.55957),
    );
  });

  it('charge the amendment the difference of premiums for the months that remain', () => {
    const amendment = byId('home-insurance-amendment');
    const yearly =
      amountAt(amendment, 'Nouvelle cotisation annuelle') -
      amountAt(amendment, '(ancienne cotisation');
    expect(cents(amountAt(amendment, '28 février 2025 :'))).toBe(cents((yearly * 5) / 12));
  });
});
