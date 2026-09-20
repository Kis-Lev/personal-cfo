// What a loan looks like TODAY, as opposed to what was typed in when it was
// added. No I/O, no state.
//
// A repayment is two different things charged in one instalment, and the
// difference matters everywhere: the interest is spent, gone for good, while
// the principal only moves — out of the account and into a smaller debt, which
// leaves the borrower no poorer. Treating the whole instalment as an expense
// understates saving by the principal; ignoring it entirely (which is what the
// app did) overstates what is left to spend by the whole instalment.
//
// The split is not fixed either. Every payment shrinks the balance, so next
// month's interest is smaller and its principal larger. A split computed once,
// when the loan was entered, is wrong by the second month — which is why the
// balance is amortized forward to today before anything is derived from it.
import { spitzerPayment } from "./interest.js";

/** Whole months from one ISO date to another, never negative. */
function monthsBetween(fromIso, toDate) {
  const from = new Date(`${fromIso}T00:00:00Z`);
  if (Number.isNaN(from.getTime())) return 0;
  const months =
    (toDate.getUTCFullYear() - from.getUTCFullYear()) * 12 + (toDate.getUTCMonth() - from.getUTCMonth());
  const dayNotReached = toDate.getUTCDate() < from.getUTCDate();
  return Math.max(0, months - (dayNotReached ? 1 : 0));
}

/**
 * The balance left after `paymentsMade` instalments of a Spitzer schedule:
 * B = P(1+r)^n - M((1+r)^n - 1)/r, with r the monthly rate.
 */
function balanceAfterPayments(principal, monthlyRate, payment, paymentsMade) {
  if (monthlyRate === 0) return principal - payment * paymentsMade;
  const growth = Math.pow(1 + monthlyRate, paymentsMade);
  return principal * growth - (payment * (growth - 1)) / monthlyRate;
}

/**
 * @param {object} loan  one entry from financial_instruments.loans
 * @param {Date} [today]
 * @returns {{
 *   remainingPrincipal: number, monthlyPayment: number, monthlyInterest: number,
 *   monthlyPrincipal: number, paymentsRemaining: number, isSettled: boolean,
 *   isDated: boolean
 * }}
 *   isDated is false for a loan saved before the balance carried a date. Its
 *   figure is then taken at face value as today's balance rather than being
 *   amortized from an unknown starting point — a guess about when it was
 *   accurate would quietly move real money in the cash flow.
 */
export function loanStateToday(loan, today = new Date()) {
  const principal = Number(loan.remaining_principal) || 0;
  const annualRate = Number(loan.annual_interest_rate) || 0;
  const termMonths = Number(loan.term_months) || 0;
  const monthlyRate = annualRate / 12;

  if (principal <= 0 || termMonths <= 0) {
    return {
      remainingPrincipal: Math.max(0, principal),
      monthlyPayment: 0,
      monthlyInterest: 0,
      monthlyPrincipal: 0,
      paymentsRemaining: 0,
      isSettled: principal <= 0,
      isDated: Boolean(loan.principal_as_of),
    };
  }

  const monthlyPayment = spitzerPayment(principal, annualRate, termMonths);
  const isDated = Boolean(loan.principal_as_of);
  const paymentsMade = isDated ? Math.min(monthsBetween(loan.principal_as_of, today), termMonths) : 0;
  const paymentsRemaining = termMonths - paymentsMade;

  if (paymentsRemaining <= 0) {
    return {
      remainingPrincipal: 0,
      monthlyPayment: 0,
      monthlyInterest: 0,
      monthlyPrincipal: 0,
      paymentsRemaining: 0,
      isSettled: true,
      isDated,
    };
  }

  const remainingPrincipal = Math.max(0, balanceAfterPayments(principal, monthlyRate, monthlyPayment, paymentsMade));
  const monthlyInterest = remainingPrincipal * monthlyRate;
  // The final instalment is whatever is left, not a full payment.
  const monthlyPrincipal = Math.min(monthlyPayment - monthlyInterest, remainingPrincipal);

  return {
    remainingPrincipal,
    monthlyPayment: monthlyInterest + monthlyPrincipal,
    monthlyInterest,
    monthlyPrincipal,
    paymentsRemaining,
    isSettled: false,
    isDated,
  };
}

/**
 * Every tracked loan added up, split the way the cash flow needs it.
 * @returns {{interest: number, principal: number, payment: number, outstanding: number, undatedCount: number}}
 */
export function loanCashflowTotals(loans = [], today = new Date()) {
  return loans.reduce(
    (totals, loan) => {
      const state = loanStateToday(loan, today);
      totals.interest += state.monthlyInterest;
      totals.principal += state.monthlyPrincipal;
      totals.payment += state.monthlyPayment;
      totals.outstanding += state.remainingPrincipal;
      if (!state.isDated && !state.isSettled) totals.undatedCount += 1;
      return totals;
    },
    { interest: 0, principal: 0, payment: 0, outstanding: 0, undatedCount: 0 }
  );
}
