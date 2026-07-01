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
