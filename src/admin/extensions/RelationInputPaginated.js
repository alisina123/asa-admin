import React, { useRef, useState, useMemo, useEffect } from 'react';
import PropTypes from 'prop-types';
import styled from 'styled-components';

import { ReactSelect } from '@strapi/helper-plugin';
import {
  Status,
  Box,
  Link,
  Icon,
  FieldLabel,
  FieldError,
  FieldHint,
  Field,
  Typography,
  Tooltip,
  VisuallyHidden,
  Flex,
} from '@strapi/design-system';
import { Cross, ChevronLeft, ChevronRight, Refresh } from '@strapi/icons';

// Import sub-components from Strapi's original RelationInput
import { Relation } from '../../../node_modules/@strapi/admin/admin/src/content-manager/components/RelationInput/components/Relation';
import { RelationItem } from '../../../node_modules/@strapi/admin/admin/src/content-manager/components/RelationInput/components/RelationItem';
import { RelationList } from '../../../node_modules/@strapi/admin/admin/src/content-manager/components/RelationInput/components/RelationList';
import { Option } from '../../../node_modules/@strapi/admin/admin/src/content-manager/components/RelationInput/components/Option';
import { usePrev } from '../../../node_modules/@strapi/admin/admin/src/content-manager/hooks';

// ─── Constants ────────────────────────────────────────────────────────────────
const ITEMS_PER_PAGE = 2;
const RELATION_ITEM_HEIGHT = 50;
const RELATION_GUTTER = 4;

// ─── Styled Components ────────────────────────────────────────────────────────
export const LinkEllipsis = styled(Link)`
  display: block;
  > span {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    display: block;
  }
`;

export const DisconnectButton = styled.button`
  svg path {
    fill: ${({ theme, disabled }) =>
      disabled ? theme.colors.neutral600 : theme.colors.neutral500};
  }
  &:hover svg path,
  &:focus svg path {
    fill: ${({ theme, disabled }) => !disabled && theme.colors.neutral600};
  }
`;

const PaginationWrapper = styled(Flex)`
  border-top: 1px solid ${({ theme }) => theme.colors.neutral150};
  padding: 8px 0 4px;
  margin-top: 4px;
`;

const PageInfo = styled(Typography)`
  font-size: 12px;
  min-width: 90px;
  text-align: center;
`;

const NavButton = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 1px solid ${({ theme }) => theme.colors.neutral200};
  border-radius: 4px;
  background: ${({ disabled, theme }) =>
    disabled ? theme.colors.neutral100 : theme.colors.neutral0};
  color: ${({ disabled, theme }) =>
    disabled ? theme.colors.neutral400 : theme.colors.neutral800};
  cursor: ${({ disabled }) => (disabled ? 'not-allowed' : 'pointer')};
  transition: all 0.2s ease;

  &:hover:not([disabled]) {
    background: ${({ theme }) => theme.colors.primary100};
    border-color: ${({ theme }) => theme.colors.primary500};
    color: ${({ theme }) => theme.colors.primary600};
  }

  svg {
    width: 12px;
    height: 12px;
  }
`;

// ─── RelationInput Component ──────────────────────────────────────────────────
const RelationInput = ({
  canReorder,
  description,
  disabled,
  error,
  iconButtonAriaLabel,
  id,
  name,
  numberOfRelationsToDisplay,
  label,
  labelAction,
  labelLoadMore,
  labelDisconnectRelation,
  listAriaDescription,
  liveText,
  loadingMessage,
  onCancel,
  onDropItem,
  onGrabItem,
  noRelationsMessage,
  onRelationConnect,
  onRelationLoadMore,
  onRelationDisconnect,
  onRelationReorder,
  onSearchNextPage,
  onSearch,
  placeholder,
  publicationStateTranslations,
  required,
  relations: paginatedRelations,
  searchResults,
  size,
}) => {
  const [value, setValue] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);

  const { data } = searchResults;
  const allRelations = paginatedRelations.data;
  const totalNumberOfRelations = allRelations.length ?? 0;

  // ── Pagination math ──────────────────────────────────────────────────────
  const totalPages = Math.max(1, Math.ceil(totalNumberOfRelations / ITEMS_PER_PAGE));
  const safePage = Math.min(currentPage, totalPages);
  const startIdx = (safePage - 1) * ITEMS_PER_PAGE;
  const endIdx = Math.min(startIdx + ITEMS_PER_PAGE, totalNumberOfRelations);
  const currentRelations = allRelations.slice(startIdx, endIdx);
  const showPagination = totalNumberOfRelations > ITEMS_PER_PAGE;

  // Clamp page when total shrinks (e.g. after removal)
  const prevTotal = usePrev(totalNumberOfRelations);
  useEffect(() => {
    if (prevTotal !== undefined && prevTotal !== totalNumberOfRelations) {
      const newTotalPages = Math.max(1, Math.ceil(totalNumberOfRelations / ITEMS_PER_PAGE));
      if (currentPage > newTotalPages) setCurrentPage(newTotalPages);
    }
  }, [totalNumberOfRelations, currentPage, prevTotal]);

  // ── ReactSelect options ──────────────────────────────────────────────────
  const options = useMemo(
    () =>
      data
        .flat()
        .filter(Boolean)
        .map((result) => ({ ...result, value: result.id, label: result.mainField })),
    [data]
  );

  // ── ReactSelect menu open/close workaround ───────────────────────────────
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const timeoutRef = useRef();
  const previousOptions = useRef([]);

  useEffect(() => {
    if (options.length > 0 && previousOptions.current.length === 0) {
      setIsMenuOpen((open) => {
        if (open) {
          timeoutRef.current = setTimeout(() => setIsMenuOpen(true), 10);
          return false;
        }
        return false;
      });
    }
    return () => { previousOptions.current = options || []; };
  }, [options]);

  useEffect(() => () => { if (timeoutRef.current) clearTimeout(timeoutRef.current); }, []);

  const handleMenuClose = () => setIsMenuOpen(false);
  const handleMenuOpen = () => { setIsMenuOpen(true); onSearch(); };

  // ── Relation reorder ─────────────────────────────────────────────────────
  const handleUpdatePositionOfRelation = (newIndex, currentIndex) => {
    if (onRelationReorder && newIndex >= 0 && newIndex < allRelations.length) {
      onRelationReorder(currentIndex, newIndex);
    }
  };

  // ── Jump to last page when new relation added ────────────────────────────
  const previewRelationsLength = usePrev(allRelations.length);
  const updatedRelationsWith = useRef();

  useEffect(() => {
    if (
      updatedRelationsWith.current === 'onChange' &&
      allRelations.length !== previewRelationsLength
    ) {
      const newTotalPages = Math.max(1, Math.ceil(allRelations.length / ITEMS_PER_PAGE));
      setCurrentPage(newTotalPages);
    }
    updatedRelationsWith.current = undefined;
  }, [previewRelationsLength, allRelations]);

  // ── Load more (fetch next server page) ──────────────────────────────────
  const handleLoadMore = () => {
    updatedRelationsWith.current = 'loadMore';
    onRelationLoadMore();
  };

  const shouldDisplayLoadMoreButton = !!labelLoadMore && paginatedRelations.hasNextPage;

  // ── Pagination handlers ──────────────────────────────────────────────────
  const handlePrevPage = () => setCurrentPage((p) => Math.max(1, p - 1));
  const handleNextPage = () => {
    if (safePage < totalPages) {
      setCurrentPage(safePage + 1);
    } else if (paginatedRelations.hasNextPage) {
      // Trigger server fetch then advance
      handleLoadMore();
      setCurrentPage(safePage + 1);
    }
  };

  const isNextDisabled = safePage >= totalPages && !paginatedRelations.hasNextPage;
  const ariaDescriptionId = `${name}-item-instructions`;

  return (
    <Field error={error} name={name} hint={description} id={id} required={required}>
      <Relation
        totalNumberOfRelations={totalNumberOfRelations}
        size={size}
        search={
          <>
            <FieldLabel action={labelAction}>{label}</FieldLabel>
            <ReactSelect
              menuPosition="absolute"
              menuPlacement="auto"
              components={{ Option }}
              options={options}
              isDisabled={disabled}
              isLoading={searchResults.isLoading}
              error={error}
              inputId={id}
              isSearchable
              isClear
              loadingMessage={() => loadingMessage}
              onChange={(relation) => {
                setValue(null);
                onRelationConnect(relation);
                updatedRelationsWith.current = 'onChange';
              }}
              onInputChange={(val) => { setValue(val); onSearch(val); }}
              onMenuClose={handleMenuClose}
              onMenuOpen={handleMenuOpen}
              menuIsOpen={isMenuOpen}
              noOptionsMessage={() => noRelationsMessage}
              onMenuScrollToBottom={() => { if (searchResults.hasNextPage) onSearchNextPage(); }}
              placeholder={placeholder}
              name={name}
              value={value}
            />
          </>
        }
        loadMore={
          shouldDisplayLoadMoreButton && (
            <button
              disabled={paginatedRelations.isLoading || paginatedRelations.isFetchingNextPage}
              onClick={handleLoadMore}
              style={{
                background: 'none',
                border: 'none',
                color: '#4945FF',
                cursor: paginatedRelations.isLoading || paginatedRelations.isFetchingNextPage
                  ? 'not-allowed' : 'pointer',
                fontSize: '12px',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                padding: '4px 0',
                opacity: paginatedRelations.isLoading || paginatedRelations.isFetchingNextPage
                  ? 0.5 : 1,
              }}
            >
              <Refresh style={{ width: '12px', height: '12px' }} />
              {labelLoadMore}
            </button>
          )
        }
      >
        {/* ── Connected Relations List ─────────────────────────────────── */}
        {currentRelations.length > 0 && (
          <RelationList overflow="">
            <VisuallyHidden id={ariaDescriptionId}>{listAriaDescription}</VisuallyHidden>
            <VisuallyHidden aria-live="assertive">{liveText}</VisuallyHidden>

            <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {currentRelations.map((relation, idx) => {
                const absoluteIndex = startIdx + idx;
                const { publicationState, href, mainField, id: relId } = relation;
                const statusColor = publicationState === 'draft' ? 'secondary' : 'success';

                return (
                  <RelationItem
                    key={`${mainField}_${relId}`}
                    ariaDescribedBy={ariaDescriptionId}
                    canDrag={canReorder && !showPagination}
                    disabled={disabled}
                    displayValue={String(mainField ?? relId)}
                    iconButtonAriaLabel={iconButtonAriaLabel}
                    id={relId}
                    index={absoluteIndex}
                    name={name}
                    endAction={
                      <DisconnectButton
                        data-testid={`remove-relation-${relId}`}
                        disabled={disabled}
                        type="button"
                        onClick={() => onRelationDisconnect(relation)}
                        aria-label={labelDisconnectRelation}
                      >
                        <Icon width="12px" as={Cross} />
                      </DisconnectButton>
                    }
                    onCancel={onCancel}
                    onDropItem={onDropItem}
                    onGrabItem={onGrabItem}
                    status={publicationState || undefined}
                    style={{ height: `${RELATION_ITEM_HEIGHT}px`, bottom: 0 }}
                    updatePositionOfRelation={handleUpdatePositionOfRelation}
                  >
                    <Box minWidth={0} paddingTop={1} paddingBottom={1} paddingRight={4}>
                      <Tooltip description={mainField ?? `${relId}`}>
                        {href ? (
                          <LinkEllipsis to={href}>{mainField ?? relId}</LinkEllipsis>
                        ) : (
                          <Typography textColor={disabled ? 'neutral600' : 'primary600'} ellipsis>
                            {mainField ?? relId}
                          </Typography>
                        )}
                      </Tooltip>
                    </Box>

                    {publicationState && (
                      <Status variant={statusColor} showBullet={false} size="S">
                        <Typography fontWeight="bold" textColor={`${statusColor}700`}>
                          {publicationStateTranslations[publicationState]}
                        </Typography>
                      </Status>
                    )}
                  </RelationItem>
                );
              })}
            </ol>

            {/* ── Pagination Controls (shown when > items per page connected) ── */}
            {showPagination && (
              <PaginationWrapper justifyContent="center" alignItems="center" gap={2}>
                <NavButton
                  type="button"
                  onClick={handlePrevPage}
                  disabled={safePage <= 1}
                  aria-label="Previous page"
                >
                  <ChevronLeft />
                </NavButton>

                <PageInfo variant="omega" textColor="neutral600">
                  Page {safePage} of {totalPages}
                </PageInfo>

                <NavButton
                  type="button"
                  onClick={handleNextPage}
                  disabled={isNextDisabled}
                  aria-label="Next page"
                >
                  <ChevronRight />
                </NavButton>
              </PaginationWrapper>
            )}
          </RelationList>
        )}

        {(description || error) && (
          <Box paddingTop={2}>
            <FieldHint />
            <FieldError />
          </Box>
        )}
      </Relation>
    </Field>
  );
};

// ─── PropTypes ────────────────────────────────────────────────────────────────
const RelationsResult = PropTypes.shape({
  data: PropTypes.arrayOf(
    PropTypes.shape({
      href: PropTypes.string,
      id: PropTypes.number.isRequired,
      publicationState: PropTypes.oneOfType([PropTypes.string, PropTypes.bool]),
      mainField: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    })
  ),
  hasNextPage: PropTypes.bool,
  isFetchingNextPage: PropTypes.bool.isRequired,
  isLoading: PropTypes.bool.isRequired,
  isSuccess: PropTypes.bool.isRequired,
});

const SearchResults = PropTypes.shape({
  data: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.number.isRequired,
      href: PropTypes.string,
      mainField: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
      publicationState: PropTypes.oneOfType([PropTypes.string, PropTypes.bool]),
    })
  ),
  hasNextPage: PropTypes.bool,
  isLoading: PropTypes.bool.isRequired,
  isSuccess: PropTypes.bool.isRequired,
});

RelationInput.defaultProps = {
  canReorder: false,
  description: undefined,
  disabled: false,
  error: undefined,
  labelAction: null,
  labelLoadMore: null,
  liveText: undefined,
  onCancel: undefined,
  onDropItem: undefined,
  onGrabItem: undefined,
  required: false,
  relations: { data: [] },
  searchResults: { data: [] },
};

RelationInput.propTypes = {
  error: PropTypes.string,
  canReorder: PropTypes.bool,
  description: PropTypes.string,
  disabled: PropTypes.bool,
  iconButtonAriaLabel: PropTypes.string.isRequired,
  id: PropTypes.string.isRequired,
  label: PropTypes.string.isRequired,
  labelAction: PropTypes.element,
  labelLoadMore: PropTypes.string,
  labelDisconnectRelation: PropTypes.string.isRequired,
  listAriaDescription: PropTypes.string.isRequired,
  liveText: PropTypes.string,
  loadingMessage: PropTypes.string.isRequired,
  name: PropTypes.string.isRequired,
  noRelationsMessage: PropTypes.string.isRequired,
  numberOfRelationsToDisplay: PropTypes.number.isRequired,
  onCancel: PropTypes.func,
  onDropItem: PropTypes.func,
  onGrabItem: PropTypes.func,
  onRelationConnect: PropTypes.func.isRequired,
  onRelationDisconnect: PropTypes.func.isRequired,
  onRelationLoadMore: PropTypes.func.isRequired,
  onRelationReorder: PropTypes.func.isRequired,
  onSearch: PropTypes.func.isRequired,
  onSearchNextPage: PropTypes.func.isRequired,
  placeholder: PropTypes.string.isRequired,
  publicationStateTranslations: PropTypes.shape({
    draft: PropTypes.string.isRequired,
    published: PropTypes.string.isRequired,
  }).isRequired,
  required: PropTypes.bool,
  searchResults: SearchResults,
  size: PropTypes.number.isRequired,
  relations: RelationsResult,
};

export default RelationInput;