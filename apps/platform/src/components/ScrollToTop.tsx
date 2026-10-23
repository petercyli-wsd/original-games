import { useEffect } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

/**
 * Opens each new page at the top. Back and Forward (POP) are left alone so the
 * browser can restore where you were, e.g. your place in the lobby.
 */
export function ScrollToTop() {
  const { pathname } = useLocation();
  const navigation = useNavigationType();
  useEffect(() => {
    if (navigation !== 'POP') window.scrollTo(0, 0);
  }, [pathname, navigation]);
  return null;
}
