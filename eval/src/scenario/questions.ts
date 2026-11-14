import type { z } from 'zod';
import type { AnswerExpectation, questionSchema } from '../schema/index.ts';
import { PARTIES, SUBJECTS } from './cast.ts';
import { money } from './model.ts';

type QuestionInput = z.input<typeof questionSchema>;

const CENT = 0.01;

const documents = (
  stated: Partial<AnswerExpectation['documents']>,
): AnswerExpectation['documents'] => ({
  required: [],
  any_of: [],
  optional: [],
  forbidden: [],
  exhaustive: false,
  ...stated,
});

const expected = (stated: Partial<AnswerExpectation>): AnswerExpectation => ({
  documents: documents({}),
  amounts: [],
  dates: [],
  counts: [],
  entities: [],
  verdict: null,
  ...stated,
});

const amount = (label: string, value: number, currency = 'EUR') => ({
  label,
  value: money(value, currency),
  tolerance: CENT,
});

const ENERGY_BILLS_2025 = [
  'energy-bill-2025-01',
  'energy-bill-2025-03',
  'energy-closing-bill-2025-04',
  'energy-bill-2025-06',
  'energy-bill-2025-08',
  'energy-bill-2025-10',
];

// Twenty questions a person would ask of these papers on the reference date. "Now",
// "still" and "this quarter" all mean that date: 15 January 2026, first quarter of 2026.
export const QUESTIONS: readonly QuestionInput[] = [
  {
    id: 'q01',
    question: "Quel est le montant total de mes factures d'électricité émises en 2025 ?",
    language: 'fr',
    tools: [
      { tool: 'describe_types', arguments: {} },
      {
        tool: 'query',
        arguments: {
          type: 'energy_bill',
          where: [
            ['core.document_date', '>=', '2025-01-01'],
            ['core.document_date', '<=', '2025-12-31'],
          ],
          aggregate: { sum: 'core.amount.value', count: '*' },
        },
      },
    ],
    expected: expected({
      amounts: [amount('total of the electricity bills dated 2025', 597.15)],
      counts: [{ label: 'electricity bills dated 2025', value: ENERGY_BILLS_2025.length }],
      documents: documents({ optional: ENERGY_BILLS_2025, forbidden: ['energy-bill-2024-11'] }),
    }),
    rationale:
      'Six bills are dated 2025, from two suppliers. The June bill exists twice as the same bytes: counted twice, the total becomes 686.05. The 2024 bill and the internet bills stay out.',
  },
  {
    id: 'q02',
    question: "Quand ai-je changé de fournisseur d'électricité, et pour lequel ?",
    language: 'fr',
    tools: [
      { tool: 'recall', arguments: { query: "changement de fournisseur d'électricité" } },
      { tool: 'timeline', arguments: { subject: SUBJECTS.home.label } },
    ],
    expected: expected({
      dates: [{ label: 'first day of supply by the new supplier', date: '2025-04-01' }],
      entities: [PARTIES.brisevent.key],
      documents: documents({
        any_of: [
          ['energy-contract-brisevent', 'energy-closing-bill-2025-04', 'energy-bill-2025-06'],
        ],
      }),
    }),
    rationale:
      'The Brisevent contract states the start of supply and names the supplier it replaces; the closing bill of Voltaneige and the first Brisevent bill confirm the date.',
  },
  {
    id: 'q03',
    question: 'Quels contrats arrivent à échéance ou se renouvellent ce trimestre ?',
    language: 'fr',
    tools: [
      {
        tool: 'upcoming',
        arguments: {
          from: '2026-01-01',
          to: '2026-03-31',
          kinds: ['expiry', 'renewal', 'notice_deadline'],
        },
      },
    ],
    expected: expected({
      dates: [
        { label: 'end of the lease term', date: '2026-01-31' },
        { label: 'renewal of the home insurance', date: '2026-03-01' },
      ],
      documents: documents({
        required: ['lease'],
        any_of: [['home-insurance-renewal-2026', 'home-insurance-contract']],
        optional: ['home-insurance-amendment'],
        forbidden: ['mobile-contract', 'car-insurance-2023', 'car-insurance-2025'],
        exhaustive: true,
      }),
    }),
    rationale:
      'The lease term ends on 31 January and the home insurance renews on 1 March. The mobile commitment would end on 9 February, but that contract was terminated; the 2023 car insurance was superseded and the 2025 one renews in June.',
  },
  {
    id: 'q04',
    question: 'Is my Telorca mobile contract still active?',
    language: 'en',
    tools: [{ tool: 'get_subject', arguments: { query: SUBJECTS.mobilePlan.label } }],
    expected: expected({
      verdict: false,
      dates: [{ label: 'day the contract ended', date: '2025-12-31' }],
      documents: documents({
        any_of: [['mobile-termination-letter', 'mobile-termination-confirmation']],
      }),
    }),
    rationale:
      'A termination letter and its confirmation by Telorca end the contract on 31 December 2025, before the reference date.',
  },
  {
    id: 'q05',
    question: 'Montre-moi tout ce qui concerne ma voiture.',
    language: 'fr',
    tools: [
      { tool: 'get_subject', arguments: { query: 'voiture' } },
      { tool: 'timeline', arguments: { subject: SUBJECTS.car.label } },
    ],
    expected: expected({
      documents: documents({
        required: [
          'car-insurance-2023',
          'car-insurance-2025',
          'garage-invoice-2025-02',
          'vehicle-inspection-2025-02',
          'parking-fine-2025-05',
          'parking-fine-contest-letter',
        ],
        optional: ['garage-invoice-photo', 'parking-ticket-2025-10'],
        forbidden: ['car-rental-receipt-2025-07'],
        exhaustive: true,
      }),
    }),
    rationale:
      'Six documents name the plate of the car. The photo shows the garage invoice again and the car park ticket names no vehicle. The Spanish invoice is for a rented car, which is not the household car.',
  },
  {
    id: 'q06',
    question: 'Quels documents ai-je reçus de Brisevent ?',
    language: 'fr',
    tools: [
      { tool: 'list_entities', arguments: { query: 'Brisevent' } },
      {
        tool: 'query',
        arguments: {
          where: [['core.issuer', '=', 'Brisevent']],
          order_by: ['core.document_date', 'asc'],
        },
      },
    ],
    expected: expected({
      entities: [PARTIES.brisevent.key],
      documents: documents({
        required: [
          'energy-contract-brisevent',
          'energy-bill-2025-06',
          'energy-bill-2025-08',
          'energy-bill-2025-10',
        ],
        optional: ['energy-bill-2025-06-copy'],
        exhaustive: true,
      }),
    }),
    rationale:
      'The contract and three bills are issued by Brisevent, written "BRISEVENT ÉLECTRICITÉ SA" on the letterhead: the name must resolve to one entity. The bank statement only mentions Brisevent.',
  },
  {
    id: 'q07',
    question:
      'How much did Telorca bill me in total on the mobile bills dated September to November 2025?',
    language: 'en',
    tools: [
      {
        tool: 'query',
        arguments: {
          type: 'mobile_bill',
          where: [
            ['core.issuer', '=', 'Telorca'],
            ['core.document_date', '>=', '2025-09-01'],
            ['core.document_date', '<=', '2025-11-30'],
          ],
          aggregate: { sum: 'core.amount.value', count: '*' },
        },
      },
    ],
    expected: expected({
      amounts: [amount('total of the three mobile bills', 64.47)],
      counts: [{ label: 'mobile bills', value: 3 }],
    }),
    rationale:
      'Three bills: 19.99, 24.49 and 19.99. The November bill only exists as the attachment of an email, and the email repeats its amount: counted as a bill too, the total becomes 84.46.',
  },
  {
    id: 'q08',
    question: 'Je cherche le document sur le remplacement des pneus.',
    language: 'fr',
    tools: [{ tool: 'search', arguments: { query: 'remplacement des pneus' } }],
    expected: expected({
      documents: documents({ any_of: [['garage-invoice-2025-02', 'garage-invoice-photo']] }),
    }),
    rationale:
      'Only the garage invoice lists tyres ("2 pneus avant"), under other words than the question: a fuzzy search. Its photo is the same paper.',
  },
  {
    id: 'q09',
    question:
      'Quelle est la date limite pour résilier mon assurance habitation avant son prochain renouvellement ?',
    language: 'fr',
    tools: [
      {
        tool: 'upcoming',
        arguments: {
          from: '2025-12-01',
          to: '2026-03-31',
          kinds: ['notice_deadline', 'renewal'],
          subject: SUBJECTS.homeInsurance.label,
        },
      },
    ],
    expected: expected({
      dates: [{ label: 'last day to give notice', date: '2026-01-01' }],
      documents: documents({
        required: ['home-insurance-renewal-2026'],
        optional: ['home-insurance-contract', 'home-insurance-amendment'],
      }),
    }),
    rationale:
      'The renewal notice prints the deadline, which is also the renewal of 1 March 2026 minus the two months of notice of the contract.',
  },
  {
    id: 'q10',
    question: 'When does the roadworthiness test of my car expire?',
    language: 'en',
    tools: [
      {
        tool: 'upcoming',
        arguments: {
          from: '2026-01-15',
          to: '2027-12-31',
          kinds: ['expiry'],
          subject: SUBJECTS.car.label,
        },
      },
    ],
    expected: expected({
      dates: [{ label: 'last day of validity of the test', date: '2027-02-19' }],
      documents: documents({ required: ['vehicle-inspection-2025-02'] }),
    }),
    rationale:
      'The test report is a scan: the date only exists in the transcription of the page. The question is in English, the document in French.',
  },
  {
    id: 'q11',
    question: 'Quel est mon loyer mensuel, charges comprises, et quand se termine mon bail ?',
    language: 'fr',
    tools: [{ tool: 'get_subject', arguments: { query: 'bail' } }],
    expected: expected({
      amounts: [amount('monthly rent with charges', 840)],
      dates: [{ label: 'end of the lease term', date: '2026-01-31' }],
      documents: documents({ required: ['lease'], optional: ['rent-receipt-2025-11'] }),
    }),
    rationale:
      'The lease states 780 EUR of rent and 60 EUR of charges, and a term ending on 31 January 2026.',
  },
  {
    id: 'q12',
    question: "Ai-je payé ma facture d'eau de juillet 2025 ?",
    language: 'fr',
    tools: [{ tool: 'search', arguments: { query: "paiement facture d'eau juillet 2025" } }],
    expected: expected({
      verdict: true,
      amounts: [amount('amount paid', 203.45)],
      dates: [{ label: 'day of the payment', date: '2025-07-28' }],
      documents: documents({
        required: ['water-payment-2025-07'],
        optional: ['water-bill-2025-07'],
      }),
    }),
    rationale: 'A receipt of the water board pays the bill of 16 July 2025 in full on 28 July.',
  },
  {
    id: 'q13',
    question: 'Do I have a loan or mortgage agreement on file?',
    language: 'en',
    tools: [{ tool: 'search', arguments: { query: 'loan agreement mortgage' } }],
    expected: expected({ verdict: false, documents: documents({ exhaustive: true }) }),
    rationale:
      'Nothing in the corpus is a loan: the right answer is that nothing was found, without a near miss such as the lease or the bank statement.',
  },
  {
    id: 'q14',
    question: "Quels documents sont datés du mois d'août 2025 ?",
    language: 'fr',
    tools: [
      {
        tool: 'query',
        arguments: {
          where: [
            ['core.document_date', '>=', '2025-08-01'],
            ['core.document_date', '<=', '2025-08-31'],
          ],
        },
      },
    ],
    expected: expected({
      documents: documents({
        required: ['energy-bill-2025-08'],
        forbidden: ['tax-notice-2025'],
        exhaustive: true,
      }),
    }),
    rationale:
      'Two documents are dated 4 August 2025. The tax notice is private: nobody asked for private documents, so it must not surface.',
  },
  {
    id: 'q15',
    question:
      "En incluant mes documents privés : combien me reste-t-il à payer d'impôt sur les revenus de 2024, et pour quelle date ?",
    language: 'fr',
    tools: [{ tool: 'query', arguments: { type: 'tax_notice', include_private: true } }],
    expected: expected({
      amounts: [amount('balance of income tax', 1284)],
      dates: [{ label: 'payment deadline', date: '2025-09-15' }],
      documents: documents({ required: ['tax-notice-2025'] }),
    }),
    rationale:
      'The same private notice, asked for explicitly this time. The notice also prints the total tax (1902 EUR): the balance is what remains to pay.',
  },
  {
    id: 'q16',
    question: 'Which of my purchases were billed in a currency other than the euro?',
    language: 'en',
    tools: [{ tool: 'query', arguments: { where: [['core.amount.currency', '!=', 'EUR']] } }],
    expected: expected({
      amounts: [
        amount('electric bicycle', 1249, 'GBP'),
        amount('cloud storage subscription', 96, 'USD'),
        amount('oak wardrobe', 4850, 'FRF'),
      ],
      documents: documents({
        required: ['bike-invoice-2024-08', 'cloud-invoice-2025-05', 'furniture-invoice-1998'],
        exhaustive: true,
      }),
    }),
    rationale:
      'Pounds, US dollars and French francs. The franc invoice also prints an indicative value in euros, which is not its amount. The travel insurance is British but billed in euros.',
  },
  {
    id: 'q17',
    question: 'Quel a été mon salaire net imposable total en 2025 ?',
    language: 'fr',
    tools: [{ tool: 'recall', arguments: { query: 'net imposable total 2025', at: '2026-01-15' } }],
    expected: expected({
      amounts: [amount('net taxable pay of 2025', 31170.5)],
      documents: documents({ any_of: [['pay-summary-2025', 'payslip-2025-12']] }),
    }),
    rationale:
      'The year-end summary states it, and the December payslip carries the same cumulative figure. Only three of the twelve payslips are in the corpus: summing them is wrong.',
  },
  {
    id: 'q18',
    question: "Mon contrat d'assurance auto de 2023 est-il toujours en vigueur ?",
    language: 'fr',
    tools: [{ tool: 'get_subject', arguments: { query: SUBJECTS.carInsurance.label } }],
    expected: expected({
      verdict: false,
      dates: [{ label: 'first day of the contract that replaced it', date: '2025-06-01' }],
      documents: documents({ required: ['car-insurance-2025'], optional: ['car-insurance-2023'] }),
    }),
    rationale: 'The 2025 contract says it cancels and replaces the 2023 one from 1 June 2025.',
  },
  {
    id: 'q19',
    question: 'Which insurance companies insure my home and my car today?',
    language: 'en',
    tools: [
      { tool: 'list_entities', arguments: { kind: 'org' } },
      { tool: 'get_subject', arguments: { query: SUBJECTS.homeInsurance.label } },
      { tool: 'get_subject', arguments: { query: SUBJECTS.carInsurance.label } },
    ],
    expected: expected({
      entities: [PARTIES.corbelin.key, PARTIES.roulavie.key],
      documents: documents({ forbidden: ['travel-insurance-2025-07'] }),
    }),
    rationale:
      'Corbelin insures the home and Roulavie the car. The travel insurer covered one trip that ended in July 2025, and the health mutual insures neither.',
  },
  {
    id: 'q20',
    question: "Combien de factures d'électricité ai-je pour chaque fournisseur ?",
    language: 'fr',
    tools: [
      {
        tool: 'query',
        arguments: {
          type: 'energy_bill',
          aggregate: { count: '*' },
          group_by: ['core.issuer'],
        },
      },
    ],
    expected: expected({
      entities: [PARTIES.voltaneige.key, PARTIES.brisevent.key],
      counts: [
        { label: 'bills from Voltaneige', value: 4 },
        { label: 'bills from Brisevent', value: 3 },
      ],
    }),
    rationale:
      'Four bills from Voltaneige, one of them scanned, and three from Brisevent once the byte-identical copy is deduplicated: the scanned bill and the native ones must land in one type, and each supplier in one entity.',
  },
];
