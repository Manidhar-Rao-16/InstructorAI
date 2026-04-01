import Swal from 'sweetalert2';

/**
 * Atlas-themed SweetAlert2 wrapper.
 * Usage:  const result = await swalConfirm({ title: '...', text: '...' });
 *         if (result.isConfirmed) { ... }
 */
export const swalConfirm = ({
    title = 'Are you sure?',
    text = 'This action cannot be undone.',
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    icon = 'warning',
} = {}) =>
    Swal.fire({
        title,
        text,
        icon,
        showCancelButton: true,
        confirmButtonText: confirmText,
        cancelButtonText: cancelText,
        reverseButtons: true,
        customClass: {
            popup: 'atlas-swal-popup',
            title: 'atlas-swal-title',
            htmlContainer: 'atlas-swal-text',
            confirmButton: 'atlas-swal-confirm',
            cancelButton: 'atlas-swal-cancel',
            icon: 'atlas-swal-icon',
            actions: 'atlas-swal-actions',
        },
        buttonsStyling: false,          // disable built-in button colours
        backdrop: 'rgba(0,0,0,0.55)',
        showClass: { popup: 'atlas-swal-show' },
        hideClass: { popup: 'atlas-swal-hide' },
    });

export default swalConfirm;
