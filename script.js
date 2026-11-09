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

  // 약관 링크 (문서 확정 전까지 이동 방지)
  form.querySelectorAll('.af-link').forEach(a => a.addEventListener('click', e => e.preventDefault()));

  // 제출 (유효성검사만 — 전송/DB 연동은 개발팀 협의 후 TODO)
  const okMsg = document.getElementById('afOk');
  form.addEventListener('submit', e => {
    e.preventDefault();
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

    if (firstErr) { firstErr.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }

    // TODO: 여기서 실제 전송(fetch POST 등) — DB 저장 위치는 개발팀 협의 후 연동
    form.querySelectorAll('.af-field, .af-checks').forEach(f => f.classList.remove('err'));
    okMsg.hidden = false;
    form.querySelector('.af-submit').disabled = true;
    okMsg.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  // 입력 시 에러 표시 해제
  form.addEventListener('input', e => {
    const field = e.target.closest('.af-field') || e.target.closest('.af-agree');
    field && field.classList.remove('err');
  });
}
