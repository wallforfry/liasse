import type { TypeTruth } from '../schema/index.ts';

const type = (
  category: string,
  parent: string | null,
  acceptable: readonly string[],
): TypeTruth => ({ category, acceptable: [...acceptable], parent });

// Types are emergent: the registry of a run names them itself. Each entry gives the slug a
// careful registry would choose, the others that say the same thing, and the parent a
// coarser registry would stop at.
// prettier-ignore
export const TYPES = {
  energyBill: type('energy_bill', 'bill', ['electricity_bill', 'utility_bill', 'power_bill']),
  mobileBill: type('mobile_bill', 'bill', ['mobile_phone_bill', 'phone_bill', 'telecom_bill']),
  internetBill: type('internet_bill', 'bill', ['broadband_bill', 'telecom_bill', 'internet_service_bill']),
  waterBill: type('water_bill', 'bill', ['utility_bill']),
  rentReceipt: type('rent_receipt', 'receipt', ['rent_invoice', 'rental_receipt']),
  paymentConfirmation: type('payment_confirmation', 'receipt', ['payment_receipt', 'payment_notice']),
  lease: type('lease', 'contract', ['lease_agreement', 'rental_agreement', 'tenancy_agreement', 'residential_lease']),
  homeInsuranceContract: type('home_insurance_contract', 'contract', ['insurance_contract', 'insurance_policy', 'home_insurance_policy']),
  contractAmendment: type('contract_amendment', 'contract', ['insurance_amendment', 'insurance_contract_amendment', 'amendment', 'policy_amendment']),
  renewalNotice: type('insurance_renewal_notice', 'notice', ['renewal_notice', 'premium_notice', 'insurance_premium_notice']),
  carInsuranceContract: type('car_insurance_contract', 'contract', ['insurance_contract', 'insurance_policy', 'motor_insurance_contract', 'auto_insurance_contract', 'vehicle_insurance_contract']),
  energyContract: type('energy_contract', 'contract', ['electricity_contract', 'energy_supply_contract', 'utility_contract']),
  mobileContract: type('mobile_plan_contract', 'contract', ['mobile_contract', 'telecom_contract', 'subscription_contract', 'mobile_subscription_contract']),
  terminationLetter: type('termination_letter', 'letter', ['contract_termination_letter', 'cancellation_letter', 'termination_request']),
  terminationConfirmation: type('termination_confirmation', 'letter', ['termination_acknowledgement', 'cancellation_confirmation', 'contract_termination_confirmation']),
  billEmail: type('bill_notification_email', 'email', ['bill_notification', 'email_notification', 'invoice_email']),
  employmentContract: type('employment_contract', 'contract', ['work_contract', 'job_contract']),
  payslip: type('payslip', 'payroll_document', ['pay_slip', 'salary_slip', 'pay_stub']),
  paySummary: type('annual_pay_summary', 'payroll_document', ['annual_salary_statement', 'annual_income_statement', 'yearly_pay_summary', 'payslip']),
  bankStatement: type('bank_statement', 'statement', ['account_statement']),
  bankNotice: type('bank_notice', 'notice', ['bank_letter', 'card_blocking_confirmation', 'bank_card_notice']),
  taxNotice: type('tax_notice', 'notice', ['income_tax_notice', 'tax_assessment', 'tax_assessment_notice']),
  fineNotice: type('traffic_fine_notice', 'notice', ['fine_notice', 'parking_fine', 'parking_fine_notice', 'penalty_notice']),
  contestLetter: type('fine_contest_letter', 'letter', ['appeal_letter', 'dispute_letter', 'complaint_letter', 'contestation_letter']),
  repairInvoice: type('vehicle_repair_invoice', 'invoice', ['repair_invoice', 'garage_invoice', 'car_repair_invoice', 'vehicle_maintenance_invoice']),
  inspectionReport: type('vehicle_inspection_report', 'certificate', ['vehicle_inspection_certificate', 'roadworthiness_certificate', 'technical_inspection_report']),
  parkingReceipt: type('parking_receipt', 'receipt', ['parking_ticket', 'payment_receipt']),
  storeReceipt: type('store_receipt', 'receipt', ['till_receipt', 'purchase_receipt', 'sales_receipt', 'retail_receipt']),
  purchaseInvoice: type('purchase_invoice', 'invoice', ['sales_invoice', 'product_invoice']),
  subscriptionInvoice: type('subscription_invoice', 'invoice', ['software_invoice', 'service_invoice', 'purchase_invoice']),
  hotelInvoice: type('hotel_invoice', 'invoice', ['accommodation_invoice', 'lodging_invoice', 'hotel_bill']),
  carRentalInvoice: type('car_rental_invoice', 'invoice', ['vehicle_rental_invoice', 'rental_invoice', 'car_rental_receipt']),
  travelInsurance: type('travel_insurance_certificate', 'certificate', ['insurance_certificate', 'travel_insurance_policy', 'insurance_contract', 'travel_insurance_contract']),
  labReport: type('medical_lab_report', 'medical_document', ['lab_report', 'medical_report', 'laboratory_report', 'blood_test_report']),
  healthStatement: type('health_reimbursement_statement', 'statement', ['reimbursement_statement', 'health_insurance_statement', 'insurance_statement']),
} as const satisfies Readonly<Record<string, TypeTruth>>;
