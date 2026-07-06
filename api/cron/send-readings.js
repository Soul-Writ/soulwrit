const authHeader = req.headers.authorization;
const expected = `Bearer ${process.env.CRON_SECRET}`;
if (authHeader !== expected) {
  return res.status(401).json({
    error: 'Unauthorized',
    debug: {
      receivedLength: authHeader ? authHeader.length : 0,
      expectedLength: expected.length,
      receivedLast5: authHeader ? authHeader.slice(-5) : null,
      expectedLast5: expected.slice(-5),
      cronSecretExists: !!process.env.CRON_SECRET,
    }
  });
}
