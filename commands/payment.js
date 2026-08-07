const PREMIUM_PRICE_LABEL = '\u20A63,000';
const PAYMENT_DETAILS = {
  bankName: 'PalmPay',
  accountName: 'Daniel Godwin Effiong',
  accountNumber: '7044438532',
};

const SUBSCRIPTION_PLANS = {
  monthly: { label: 'Monthly Premium', durationDays: 30 },
  termly: { label: 'Termly Premium', durationDays: 90 },
  yearly: { label: 'Yearly Premium', durationDays: 365 },
};

function createPaymentFlowState() {
  return new Map();
}

function createPaymentCommand(db, paymentFlows) {
  return async function handlePaymentCommand({ message, username, userId }) {
    if (message.hasMedia) {
      await message.reply([
        'No screenshot or receipt upload is needed.',
        '',
        'Please type payment again, then answer the verification questions in text.',
      ].join('\n'));
      return;
    }

    paymentFlows.set(userId, {
      username,
      step: 'bank_name',
      data: {},
    });

    await message.reply([
      '*Payment Verification*',
      '',
      'Please reply with the bank name you used to make the payment.',
      '',
      'Type cancel to stop this request.',
    ].join('\n'));
  };
}

function createPaymentFlowMessageHandler(db, paymentFlows) {
  return async function handlePaymentFlowMessage({ message, text, username, userId }) {
    const flow = paymentFlows.get(userId);
    if (!flow) return false;

    const value = String(text || '').trim();
    if (!value) return true;

    if (value.toLowerCase() === 'cancel') {
      paymentFlows.delete(userId);
      await message.reply('Payment verification cancelled. You can type payment whenever you are ready.');
      return true;
    }

    if (message.hasMedia) {
      await message.reply('Please answer with text only. No screenshot or receipt upload is required.');
      return true;
    }

    if (flow.step === 'bank_name') {
      flow.data.bankName = value;
      flow.step = 'amount_paid';
      await message.reply([
        'How much did you pay?',
        '',
        'Example: 3000',
      ].join('\n'));
      return true;
    }

    if (flow.step === 'amount_paid') {
      const amountPaid = parseAmount(value);
      if (!Number.isFinite(amountPaid) || amountPaid <= 0) {
        await message.reply('Please enter the amount paid as a number. Example: 3000');
        return true;
      }

      flow.data.amountPaid = amountPaid;
      flow.step = 'account_last4';
      await message.reply([
        'Finally, send the last 4 digits of the account you used for payment.',
        '',
        'Example: 1234',
      ].join('\n'));
      return true;
    }

    if (flow.step === 'account_last4') {
      const accountLast4 = value.replace(/\D/g, '');
      if (!/^\d{4}$/.test(accountLast4)) {
        await message.reply('Please send exactly the last 4 digits of the account used for payment.');
        return true;
      }

      const status = db.getSubscriptionStatus(userId);
      const requestId = db.createPaymentRequest({
        userId,
        username: flow.username || username,
        selectedPlan: 'monthly',
        durationDays: SUBSCRIPTION_PLANS.monthly.durationDays,
        receiptText: null,
        currentPlan: status.plan,
        bankName: flow.data.bankName,
        amountPaid: flow.data.amountPaid,
        accountLast4,
      });

      paymentFlows.delete(userId);
      await message.reply([
        'Payment request submitted for admin review.',
        '',
        `Request ID: ${requestId}`,
        `Amount Paid: ${formatMoney(flow.data.amountPaid)}`,
        `Bank Name: ${flow.data.bankName}`,
        `Account Last 4 Digits: ${accountLast4}`,
        'Status: Pending',
        '',
        'You will receive a message once your subscription has been reviewed.',
      ].join('\n'));
      return true;
    }

    paymentFlows.delete(userId);
    await message.reply('Something went wrong with that payment request. Please type payment to start again.');
    return true;
  };
}

function createAdminDashboardCommand(db) {
  return async function handleAdminDashboardCommand({ message, userId, prefix }) {
    if (!db.hasManagementAccess(userId)) {
      await message.reply('Only the StudyPal owner or an admin can view the subscription dashboard.');
      return;
    }

    const stats = db.getSubscriptionDashboardStats();
    const pending = db.listPendingPaymentRequests(10);
    const lines = [
      '*StudyPal Admin Dashboard*',
      '',
      `Total Users: ${stats.totalUsers}`,
      `Free Users: ${stats.freeUsers}`,
      `Premium Users: ${stats.premiumUsers}`,
      `VIP Users: ${stats.vipUsers}`,
      `Expired Premium Users: ${stats.expiredPremiumUsers}`,
      `Pending Subscription Requests: ${stats.pendingPaymentRequests}`,
      '',
      '*Pending Subscription Requests*',
    ];

    if (!pending.length) {
      lines.push('No pending subscription requests.');
    } else {
      pending.forEach((request) => {
        lines.push('');
        lines.push(`#${request.id}`);
        lines.push(`Student Name: ${request.username || 'Student'}`);
        lines.push(`WhatsApp Number: ${request.phone_number || phoneFromUserId(request.user_id) || 'Unknown'}`);
        lines.push(`Amount Paid: ${formatMoney(request.amount_paid)}`);
        lines.push(`Bank Name: ${request.bank_name || 'Not provided'}`);
        lines.push(`Account Last 4 Digits: ${request.account_last4 || 'Not provided'}`);
        lines.push(`Status: ${capitalize(request.payment_status)}`);
        lines.push(`Date Submitted: ${formatDateTime(request.submitted_at)}`);
        lines.push(`Selected Plan: ${planLabel(request.selected_plan)} (${request.duration_days} days)`);
        lines.push(`Approve: ${prefix}approvepremium ${request.id}`);
        lines.push(`Reject: ${prefix}rejectpayment ${request.id} [reason]`);
      });
    }

    await message.reply(lines.join('\n'));
  };
}

function createApprovePremiumCommand(db, sendDirectMessage) {
  return async function handleApprovePremiumCommand({ message, args, userId, prefix }) {
    if (!db.hasManagementAccess(userId)) {
      await message.reply('Only the StudyPal owner or an admin can approve premium payments.');
      return;
    }

    const requestId = Number(args[0]);
    const overrideDays = Number(args[1]);
    if (!Number.isInteger(requestId) || requestId <= 0) {
      await message.reply(`Usage: ${prefix}approvepremium <requestId> [days]`);
      return;
    }

    const request = db.getPaymentRequest(requestId);
    if (!request) {
      await message.reply(`Payment request #${requestId} was not found.`);
      return;
    }
    if (request.payment_status !== 'pending') {
      await message.reply(`Payment request #${requestId} is already ${request.payment_status}.`);
      return;
    }

    const activatedAt = new Date();
    const durationDays = Number.isFinite(overrideDays) && overrideDays > 0
      ? overrideDays
      : Number(request.duration_days || 30);
    const expiresAt = addDaysIso(activatedAt, durationDays);

    db.updateSubscription({
      userId: request.user_id,
      plan: 'premium',
      activatedAt: activatedAt.toISOString(),
      expiresAt,
    });
    db.updatePaymentRequestStatus({
      requestId,
      status: 'approved',
      reviewedBy: userId,
    });

    const userMessage = [
      'Congratulations!',
      '',
      'Your StudyPal Premium subscription has been approved and activated.',
      '',
      `Expiry Date: ${expiresAt.slice(0, 10)}`,
      '',
      'You now have unlimited questions, unlimited subjects, and unlimited AI access.',
    ].join('\n');

    if (sendDirectMessage) {
      await sendDirectMessage(request.user_id, userMessage);
    }

    await message.reply([
      'Premium approved.',
      `Request ID: ${requestId}`,
      `Student: ${request.username || request.user_id}`,
      `Activation Date: ${activatedAt.toISOString().slice(0, 10)}`,
      `Expiration Date: ${expiresAt.slice(0, 10)}`,
      sendDirectMessage ? 'User notified automatically.' : 'User notification could not be sent because direct messaging is not configured.',
    ].join('\n'));
  };
}

function createRejectPaymentCommand(db, sendDirectMessage) {
  return async function handleRejectPaymentCommand({ message, args, userId, prefix }) {
    if (!db.hasManagementAccess(userId)) {
      await message.reply('Only the StudyPal owner or an admin can reject payments.');
      return;
    }

    const requestId = Number(args[0]);
    const reason = args.slice(1).join(' ').trim();
    if (!Number.isInteger(requestId) || requestId <= 0) {
      await message.reply(`Usage: ${prefix}rejectpayment <requestId> [reason]`);
      return;
    }

    const request = db.getPaymentRequest(requestId);
    if (!request) {
      await message.reply(`Payment request #${requestId} was not found.`);
      return;
    }
    if (request.payment_status !== 'pending') {
      await message.reply(`Payment request #${requestId} is already ${request.payment_status}.`);
      return;
    }

    db.updatePaymentRequestStatus({
      requestId,
      status: 'rejected',
      reviewedBy: userId,
      rejectionReason: reason || 'Payment could not be verified.',
    });

    const userMessage = [
      'Your StudyPal Premium payment request was not approved.',
      '',
      `Reason: ${reason || 'Payment could not be verified.'}`,
      '',
      'Please contact StudyPal support if you believe this is a mistake.',
    ].join('\n');

    if (sendDirectMessage) {
      await sendDirectMessage(request.user_id, userMessage);
    }

    await message.reply([
      'Payment rejected.',
      `Request ID: ${requestId}`,
      `Student: ${request.username || request.user_id}`,
      sendDirectMessage ? 'User notified automatically.' : 'User notification could not be sent because direct messaging is not configured.',
    ].join('\n'));
  };
}

function createPaymentReceiptCommand(db) {
  return async function handlePaymentReceiptCommand({ message, userId }) {
    if (!db.hasManagementAccess(userId)) {
      await message.reply('Only the StudyPal owner or an admin can view payment records.');
      return;
    }

    await message.reply('Receipt uploads are no longer used. Open the dashboard to review text payment requests.');
  };
}

function formatSubscriptionPaymentDetails() {
  return [
    '*StudyPal Premium*',
    '',
    `Price: ${PREMIUM_PRICE_LABEL}`,
    '',
    '*Payment Details*',
    `Bank Name: ${PAYMENT_DETAILS.bankName}`,
    `Account Number: ${PAYMENT_DETAILS.accountNumber}`,
    `Account Name: ${PAYMENT_DETAILS.accountName}`,
    '',
    '*Payment Instructions*',
    '1. Make the payment to the account above.',
    '2. After payment, type payment.',
    '3. Enter your bank name, amount paid, and the last 4 digits of the account used.',
    '4. Your request will show as Pending in the Admin Dashboard until approved.',
    '',
    'No screenshot or receipt upload is required.',
  ].join('\n');
}

function parseAmount(value) {
  return Number(String(value || '').replace(/[^\d.]/g, ''));
}

function formatMoney(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 'Not provided';
  return `\u20A6${amount.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

function addDaysIso(date, days) {
  const value = new Date(date);
  value.setDate(value.getDate() + Number(days || 30));
  return value.toISOString();
}

function formatDateTime(value) {
  if (!value) return 'Unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toISOString().replace('T', ' ').slice(0, 16);
}

function planLabel(planKey) {
  return SUBSCRIPTION_PLANS[planKey]?.label || capitalize(planKey || 'monthly');
}

function capitalize(value) {
  return String(value || '').charAt(0).toUpperCase() + String(value || '').slice(1);
}

function phoneFromUserId(userId) {
  return String(userId || '').split('@')[0].replace(/\D/g, '') || null;
}

module.exports = {
  PAYMENT_DETAILS,
  SUBSCRIPTION_PLANS,
  createPaymentFlowState,
  createPaymentCommand,
  createPaymentFlowMessageHandler,
  createAdminDashboardCommand,
  createApprovePremiumCommand,
  createRejectPaymentCommand,
  createPaymentReceiptCommand,
  formatSubscriptionPaymentDetails,
};
