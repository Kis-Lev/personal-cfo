// Pure, deterministic interest-rate math — PRD section 4.2. No I/O, no state.

/**
 * Compound interest growth: A = P * (1 + r/n)^(n*t)
 * @param {number} principal        P
 * @param {number} annualInterestRate r (e.g. 0.04 for 4%)
 * @param {number} compoundingFrequency n (times per year, see COMPOUNDING_FREQUENCY)
 * @param {number} years            t
 */
export function compoundInterest(principal, annualInterestRate, compoundingFrequency, years) {
  return principal * Math.pow(1 + annualInterestRate / compoundingFrequency, compoundingFrequency * years);
}

/**
 * Monthly loan repayment under the Spitzer (constant-payment) schedule:
 * M = P * [r(1+r)^n] / [(1+r)^n - 1], where r is the MONTHLY rate.
 * Falls back to a flat P/n split when the rate is 0 (the formula divides by zero there).
 */
export function spitzerPayment(remainingPrincipal, annualInterestRate, termMonths) {
  const monthlyRate = annualInterestRate / 12;
  if (monthlyRate === 0) {
    return remainingPrincipal / termMonths;
  }
  const growth = Math.pow(1 + monthlyRate, termMonths);
  return (remainingPrincipal * monthlyRate * growth) / (growth - 1);
}
