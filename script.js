// 스크롤 진입 애니메이션
const io = new IntersectionObserver((es) => {
  es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
}, { threshold: .12 });
document.querySelectorAll('.reveal').forEach(el => io.observe(el));

// 플로팅 카카오 버튼 (스크롤 시 노출)
const fab = document.getElementById('fab');
addEventListener('scroll', () => { fab.classList.toggle('show', scrollY > 500); }, { passive: true });

// FAQ 아코디언
document.querySelectorAll('.faq-q').forEach(q => {
  q.addEventListener('click', () => {
    const item = q.closest('.faq-item');
    const open = item.classList.toggle('open');
    q.setAttribute('aria-expanded', open);
  });
});

// 방문 집계 — 유입 경로(?from=)와 횟수만 CRM에 알린다. 이름·연락처 등 개인정보는 보내지 않는다.
const SOURCE_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const visitBase = (() => {
  try {
    const origin = document.querySelector('meta[name="crm-origin"]').content.trim();
    const url = new URL(origin);
    const local = host => host === '127.0.0.1' || host === 'localhost';
    if (url.origin !== origin || (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === '127.0.0.1'))) return '';
    // 내 PC에서 연 페이지가 운영 CRM의 집계를 올리지 않게 한다.
    if (local(location.hostname) && !local(url.hostname)) return '';
    return url.origin;
  } catch { return ''; }
})();
// 주소의 ?from=sk 처럼 붙은 유입 경로. 탭을 닫기 전까지는 다른 페이지를 다녀와도 유지한다.
const visitSource = (() => {
  let value = '';
  try {
    const params = new URLSearchParams(location.search);
    value = (params.get('from') || params.get('utm_source') || '').trim().toLowerCase();
  } catch {}
  try {
    if (SOURCE_RE.test(value)) sessionStorage.setItem('cle-from', value);
    else value = sessionStorage.getItem('cle-from') || '';
  } catch {}
  return SOURCE_RE.test(value) ? value : '';
})();
function trackVisit(event) {
  if (!visitBase) return;
  const body = { event };
  if (visitSource) body.source = visitSource;
  if (event === 'view') {
    // 오늘 처음 들어온 기기인지만 표시한다(브라우저에는 날짜만 남긴다). 저장소를 못 쓰는 환경은 매번 첫 방문으로 센다.
    let first = true;
    try {
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
      first = localStorage.getItem('cle-visit-day') !== today;
      if (first) localStorage.setItem('cle-visit-day', today);
    } catch {}
    body.first = first;
  }
  try {
    fetch(`${visitBase}/api/public/education-visits`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), credentials: 'omit', keepalive: true
    }).catch(() => {});
  } catch {}
}
trackVisit('view');

// 신청 폼
const form = document.getElementById('applyForm');
if (form) {
  // 연락처 자동 하이픈 (010-0000-0000)
  const phone = document.getElementById('af-phone');
  phone.addEventListener('input', () => {
    const d = phone.value.replace(/\D/g, '').slice(0, 11);
    phone.value = d.length < 4 ? d
      : d.length < 8 ? `${d.slice(0, 3)}-${d.slice(3)}`
      : `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  });

  // 비고란 글자수 카운터
  const note = document.getElementById('af-note');
  const counter = document.getElementById('afCount');
  note.addEventListener('input', () => { counter.textContent = note.value.length; });

  // 동일한 신청은 결과가 불확실해도 같은 식별자와 내용으로 재시도합니다.
  const okMsg = document.getElementById('afOk');
  const errorMsg = document.getElementById('afError');
  const submit = form.querySelector('.af-submit');
  let pending = false;
  let command = null;
  let uncertain = false;
  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (pending || !okMsg.hidden) return;
    let firstErr = null;

    // 필수 입력/선택 검사
    form.querySelectorAll('[required]').forEach(el => {
      const field = el.closest('.af-field') || el.closest('.af-agree');
      const invalid = el.type === 'checkbox' ? !el.checked : !el.value.trim();
      field && field.classList.toggle('err', invalid);
      if (invalid && !firstErr) firstErr = field;
    });

    // 필요한 과목 최소 1개
    const subjField = form.querySelector('.af-checks').closest('.af-field');
    const noSubject = !form.querySelector('input[name="subject"]:checked');
    subjField.classList.toggle('err', noSubject);
    if (noSubject && !firstErr) firstErr = subjField;

    const checks = [
      [document.getElementById('af-name'), value => value.length <= 80],
      [phone, value => /^010-?\d{4}-?\d{4}$/.test(value)],
      [document.getElementById('af-grade'), value => value.length <= 100],
      [note, value => value.length <= 500]
    ];
    checks.forEach(([el, valid]) => {
      if (!valid(el.value.trim())) {
        const field = el.closest('.af-field');
        field.classList.add('err');
        if (!firstErr) firstErr = field;
      }
    });
    if (firstErr) { errorMsg.textContent = '입력 내용을 확인해주세요. 연락처는 010으로 시작하는 11자리, 성명은 80자, 학년은 100자 이내여야 합니다.'; errorMsg.hidden = false; firstErr.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }

    const origin = document.querySelector('meta[name="crm-origin"]').content.trim();
    let endpoint;
    try {
      const url = new URL(origin);
      if (url.origin !== origin || (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === '127.0.0.1'))) throw new Error('invalid origin');
      endpoint = `${url.origin}/api/public/education-applications`;
    } catch {
      errorMsg.textContent = '신청 서비스를 아직 사용할 수 없습니다. 카카오톡으로 문의해주세요.';
      errorMsg.hidden = false;
      return;
    }
    if (!command) {
      try {
        command = {
          requestId: crypto.randomUUID(),
          name: document.getElementById('af-name').value.trim(),
          phone: phone.value.trim(),
          childCount: document.getElementById('af-count').value,
          grade: document.getElementById('af-grade').value.trim(),
          subjects: Array.from(form.querySelectorAll('input[name="subject"]:checked'), el => el.value),
          note: note.value.trim(),
          consent: document.getElementById('af-agree').checked,
          consentVersion: '2026-11-10'
        };
      } catch {
        errorMsg.textContent = '신청을 시작할 수 없습니다. 카카오톡으로 문의해주세요.';
        errorMsg.hidden = false;
        return;
      }
      form.querySelectorAll('input, select, textarea').forEach(el => { el.disabled = true; });
    }
    pending = true;
    submit.disabled = true;
    errorMsg.hidden = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(command), signal: controller.signal, credentials: 'omit'
      });
      if (response.status === 400 && !uncertain) {
        command = null;
        form.querySelectorAll('input, select, textarea').forEach(el => { el.disabled = false; });
        errorMsg.textContent = '입력 내용을 확인하고 수정한 뒤 다시 신청해주세요.';
        errorMsg.hidden = false;
        return;
      }
      if (!response.ok) throw new Error('HTTP ' + response.status);
      okMsg.hidden = false;
      trackVisit('submit');
      okMsg.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch {
      uncertain = true;
      errorMsg.textContent = '접수 여부를 확인하지 못했습니다. 같은 신청으로 다시 시도하거나 카카오톡으로 문의해주세요. 새로고침하면 중복 신청될 수 있습니다.';
      errorMsg.hidden = false;
    } finally {
      clearTimeout(timer);
      pending = false;
      submit.disabled = !okMsg.hidden;
    }
  });

  // 입력 시 에러 표시 해제
  form.addEventListener('input', e => {
    const field = e.target.closest('.af-field') || e.target.closest('.af-agree');
    field && field.classList.remove('err');
  });
}
