import React, { useEffect, useRef } from 'react';

interface KoiActionPanelProps {
  className: string;
  children: React.ReactNode;
}

// 코이를 고르는 도중 손가락 아래에 버튼이 나타날 수 있으므로,
// 이 패널의 버튼에서 새로 시작한 터치/마우스 입력만 실행합니다.
export const KoiActionPanel: React.FC<KoiActionPanelProps> = ({ className, children }) => {
  const pressedButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    // 버튼 밖으로 끌어 손을 떼면 click이 오지 않을 수 있습니다. 다음 입력이
    // 연못에서 시작하더라도 이전 버튼 누름이 남지 않도록 캡처 단계에서 비웁니다.
    const resetPress = () => { pressedButtonRef.current = null; };
    window.addEventListener('pointerdown', resetPress, true);
    return () => window.removeEventListener('pointerdown', resetPress, true);
  }, []);

  const getButton = (target: EventTarget | null) =>
    target instanceof Element ? target.closest('button') : null;

  return (
    <div
      className={className}
      onPointerDownCapture={event => {
        pressedButtonRef.current = getButton(event.target);
      }}
      onPointerCancelCapture={() => {
        pressedButtonRef.current = null;
      }}
      onClickCapture={event => {
        const pressedButton = pressedButtonRef.current;
        pressedButtonRef.current = null;

        // 키보드와 보조 기술의 클릭(detail=0)은 포인터 입력 없이도 허용합니다.
        // 아이콘을 눌러도 같은 버튼인지 비교하고, 다른 곳에서 시작한 클릭은 차단합니다.
        if (event.detail > 0 && pressedButton !== getButton(event.target)) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
    >
      {children}
    </div>
  );
};
