export const config = { matcher: ['/admin', '/admin/:path*', '/admin.html'] };

export default function middleware(request) {
  const auth = request.headers.get('authorization') || '';
  const [type, encoded] = auth.split(' ');
  const expected = process.env.BASIC_AUTH_PASSWORD;
  const valid = !!expected && type === 'Basic' &&
    Buffer.from(encoded || '', 'base64').toString().split(':')[1] === expected;

  if (!valid) {
    return new Response('Unauthorized', {
      status: 401,
      headers: { 'WWW-Authenticate': 'Basic realm="Admin"' },
    });
  }
}
