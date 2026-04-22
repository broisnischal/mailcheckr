import { beforeEach, expect, test } from "bun:test";
import {
  INVALID_REASON_AMOUNT_OF_AT,
  INVALID_REASON_DNS_ERROR,
  INVALID_REASON_DNS_TIMEOUT,
  INVALID_REASON_DOMAIN_IN_BLOCKLIST,
  INVALID_REASON_DOMAIN_POPULAR_TYPO,
  INVALID_REASON_NO_DNS_MX_RECORDS,
  INVALID_REASON_SMTP_MAILBOX_NOT_FOUND,
  INVALID_REASON_SMTP_UNVERIFIABLE,
  checkEmail,
  clearMxCache,
} from "../src/index";

beforeEach(() => {
  clearMxCache();
});

test("rejects invalid syntax with reason id", async () => {
  const result = await checkEmail("not-an-email");
  expect(result.valid).toBe(false);
  expect(result.reasonId).toBe(INVALID_REASON_AMOUNT_OF_AT);
});

test("blocks listed domains", async () => {
  const result = await checkEmail("user@disposable-email.com", {
    blocklistDomains: ["disposable-email.com"],
    level: "dns",
    skipCache: true,
  });
  expect(result.valid).toBe(false);
  expect(result.reasonId).toBe(INVALID_REASON_DOMAIN_IN_BLOCKLIST);
});

test("detects common typos", async () => {
  const result = await checkEmail("someone@hotnail.com");
  expect(result.valid).toBe(false);
  expect(result.reasonId).toBe(INVALID_REASON_DOMAIN_POPULAR_TYPO);
});

test("accepts custom mxResolver", async () => {
  const result = await checkEmail("someone@example.com", {
    mxResolver: async () => ["mail.example.com"],
    skipCache: true,
  });
  expect(result.valid).toBe(true);
  expect(result.mxRecords).toEqual(["mail.example.com"]);
});

test("supports no records via custom resolver", async () => {
  const result = await checkEmail("someone@example.com", {
    mxResolver: async () => [],
    skipCache: true,
  });
  expect(result.valid).toBe(false);
  expect(result.reasonId).toBe(INVALID_REASON_NO_DNS_MX_RECORDS);
});

test("can disable disposable check", async () => {
  const result = await checkEmail("user@mailinator.com", {
    checkDisposable: false,
    checkMx: false,
  });
  expect(result.valid).toBe(true);
});

test("can disable typo check", async () => {
  const result = await checkEmail("someone@hotnail.com", {
    checkTypo: false,
    checkMx: false,
    checkDisposable: false,
  });
  expect(result.valid).toBe(true);
});

test("uses popular mx cache seed for common domains", async () => {
  const result = await checkEmail("someone@gmail.com", {
    mxResolver: async () => {
      throw new Error("should not call custom resolver");
    },
  });
  expect(result.valid).toBe(true);
  expect(result.message).toBe("MX records found (popular cache seed)");
});

test("can disable popular mx cache seed", async () => {
  const result = await checkEmail("someone@gmail.com", {
    usePopularMxCache: false,
    mxResolver: async () => false,
    skipCache: true,
  });
  expect(result.valid).toBe(false);
});

test("supports syntax-only mode", async () => {
  const result = await checkEmail("any@mailinator.com", {
    level: "syntax",
  });
  expect(result.valid).toBe(true);
  expect(result.checks.dns).toBe(false);
});

test("retries dns resolver after transient failure", async () => {
  let attempts = 0;
  const result = await checkEmail("someone@custom.io", {
    skipCache: true,
    usePopularMxCache: false,
    dohRetryAmount: 2,
    mxResolver: async () => {
      attempts++;
      if (attempts < 2) return false;
      return ["mx.custom.io"];
    },
  });
  expect(attempts).toBe(2);
  expect(result.valid).toBe(true);
});

test("returns timeout reason when resolver hangs", async () => {
  const result = await checkEmail("someone@hang.io", {
    timeout: 10,
    skipCache: true,
    usePopularMxCache: false,
    mxResolver: async () => new Promise<string[]>(() => {}),
  });
  expect(result.valid).toBe(false);
  expect(result.reasonId).toBe(INVALID_REASON_DNS_TIMEOUT);
});

test("returns dns_error for resolver indeterminate response", async () => {
  const result = await checkEmail("someone@unknown.io", {
    skipCache: true,
    usePopularMxCache: false,
    mxResolver: async () => false,
  });
  expect(result.valid).toBe(false);
  expect(result.reasonId).toBe(INVALID_REASON_DNS_ERROR);
});

test("uses internal cache to avoid duplicate network resolver calls", async () => {
  let calls = 0;
  const options = {
    skipCache: false,
    cache: true,
    usePopularMxCache: false,
    mxResolver: async () => {
      calls++;
      return ["mx.cache.io"];
    },
  };
  const first = await checkEmail("first@cache.io", options);
  const second = await checkEmail("second@cache.io", options);
  expect(first.valid).toBe(true);
  expect(second.valid).toBe(true);
  expect(second.message).toBe("MX records found (cached)");
  expect(calls).toBe(1);
});

test("uses custom popular cache override", async () => {
  const result = await checkEmail("someone@company.tld", {
    popularMxCache: {
      "company.tld": ["mx1.company.tld"],
    },
    mxResolver: async () => {
      throw new Error("should not call custom resolver");
    },
  });
  expect(result.valid).toBe(true);
  expect(result.mxRecords).toEqual(["mx1.company.tld"]);
});

test("smtp probe marks mailbox as not existing", async () => {
  const result = await checkEmail("someone@mxprobe.tld", {
    smtpProbe: true,
    mxResolver: async () => ["mx.mxprobe.tld"],
    smtpProbeClient: async () => ({
      status: "not_exists",
      code: 550,
      response: "Mailbox unavailable",
      host: "mx.mxprobe.tld",
    }),
  });
  expect(result.valid).toBe(false);
  expect(result.reasonId).toBe(INVALID_REASON_SMTP_MAILBOX_NOT_FOUND);
  expect(result.checks.smtp).toBe(true);
});

test("smtp probe marks mailbox as unverifiable", async () => {
  const result = await checkEmail("someone@mxprobe.tld", {
    smtpProbe: true,
    mxResolver: async () => ["mx.mxprobe.tld"],
    smtpProbeClient: async () => ({
      status: "unverifiable",
      response: "Connection refused",
      host: "mx.mxprobe.tld",
    }),
  });
  expect(result.valid).toBe(false);
  expect(result.reasonId).toBe(INVALID_REASON_SMTP_UNVERIFIABLE);
});

test("smtp probe accepts existing mailbox", async () => {
  const result = await checkEmail("someone@mxprobe.tld", {
    smtpProbe: true,
    mxResolver: async () => ["mx.mxprobe.tld"],
    smtpProbeClient: async () => ({
      status: "exists",
      code: 250,
      response: "OK",
      host: "mx.mxprobe.tld",
    }),
  });
  expect(result.valid).toBe(true);
  expect(result.message).toBe("Mailbox accepted by SMTP RCPT probe");
});

test("smtp probe timeout option is forwarded in ms", async () => {
  let seenTimeout = 0;
  const result = await checkEmail("someone@mxprobe.tld", {
    smtpProbe: true,
    smtpProbeTimeoutMs: 1234,
    mxResolver: async () => ["mx.mxprobe.tld"],
    smtpProbeClient: async (args) => {
      seenTimeout = args.timeoutMs;
      return { status: "exists", code: 250, host: "mx.mxprobe.tld" };
    },
  });
  expect(result.valid).toBe(true);
  expect(seenTimeout).toBe(1234);
});

test("gmail mailbox sample is treated as valid", async () => {
  const result = await checkEmail("nischaldahal01395@gmail.com");
  expect(result.valid).toBe(true);
});

test("gmail mailbox sample is treated as invalid", async () => {
  const result = await checkEmail(
    "nischaasdfasdfasdfasdfasdfasdfasdfldadfdffdshal01395@gmail.com",
    {
      smtpProbe: true,
    },
  );
  expect(result.valid).toBe(false);
});
