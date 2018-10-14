'use strict';

/* global ColorHash, BootstrapDialog, moment, ics, firebase, firebaseui, ga */
/* global CourseManager, CourseButtonList, CourseExamInfo, CourseCalendar */
/* global courses_from_rishum, availableSemesters, currentSemester, scheduleSharingUserId */

(function () {
    var courseManager = new CourseManager(courses_from_rishum);
    var colorHash = new ColorHash();
    var firestoreDb = null;
    var viewingSharedSchedule = false;
    var coursesChosen = {};
    var previewingFromSelectControl = null;
    var allCoursesCount = 0, filteredCoursesCount = 0;
    var stopScheduleWatching = null;
    var currentSavedSession = null, savedSessionForUndo = null, savedSessionForRedo = null;

    // UI components.
    var loginDialog = null;
    var courseSelect = null;
    var filterDialog = null;
    var courseButtonList = null;
    var courseExamInfo = null;
    var courseCalendar = null;

    cheeseforkInit();

    function cheeseforkInit() {
        $('[data-toggle="tooltip"]').tooltip();

        viewingSharedSchedule = scheduleSharingUserId ? true : false;

        navbarInit();

        if (!viewingSharedSchedule) {
            var allCourses = courseManager.getAllCourses();
            allCoursesCount = allCourses.length;
            filteredCoursesCount = allCourses.length;

            courseSelect = $('#select-course').selectize({
                //searchConjunction: 'or',
                options: makeCourseSelectOptions(allCourses.sort()),
                maxOptions: 202,
                render: {
                    option: function (item) {
                        if (item.value === 'filter') {
                            var text = 'סינון קורסים';

                            if (filteredCoursesCount < allCoursesCount) {
                                text += ' (' + filteredCoursesCount + '/' + allCoursesCount + ')';
                            }

                            return $('<div>').addClass('option font-weight-bold').text(text);
                        } else if (item.value === 'partial') {
                            return $('<div>').addClass('option font-italic').text('מציג 200 קורסים ראשונים');
                        }

                        var course = item.value;
                        var general = courseManager.getGeneralInfo(course);

                        var courseDescriptionHtml = $('<div>').text(courseManager.getDescription(course)).html().replace(/\n/g, '<br>');

                        var courseNumber = $('<abbr>').text(general['מספר מקצוע'])
                            .prop('title', courseDescriptionHtml)
                            .attr({
                                'data-toggle': 'tooltip',
                                'data-html': 'true',
                                'data-placement': 'right',
                                'data-template': '<div class="tooltip" role="tooltip"><div class="arrow"></div><div class="tooltip-inner course-description-tooltip-inner"></div></div>',
                                'data-boundary': 'viewport'
                            });

                        return $('<div>').addClass('option').append(courseNumber)
                            .append(document.createTextNode(' - ' + general['שם מקצוע'])).get(0);
                    }
                },
                onItemAdd: function (course) {
                    if (course === 'filter') {
                        filterOpen();
                    } else if (course === 'partial') {
                        // Do nothing
                    } else if (!coursesChosen.propertyIsEnumerable(course)) {
                        coursesChosen[course] = true;
                        courseButtonList.addCourse(course);
                        courseCalendar.addCourse(course);
                        selectedCourseSave(course);
                        updateGeneralInfoLine();
                        courseExamInfo.renderCourses(getSelectedCourses());
                        // Can't apply filter inside onItemAdd since it changes the select contents.
                        setTimeout(filterApply, 0);
                    }
                    this.clear();
                },
                onDropdownItemActivate: function (course) {
                    if (course === 'filter' || course === 'partial') {
                        return;
                    }

                    previewingFromSelectControl = course;

                    if (!coursesChosen.propertyIsEnumerable(course)) {
                        courseCalendar.addCourse(course);
                        courseExamInfo.renderCourses(getSelectedCourses().concat([course]));
                    }
                    courseExamInfo.setHighlighted(course);
                    courseCalendar.previewCourse(course);
                },
                onDropdownItemDeactivate: function (course) {
                    if (course === 'filter' || course === 'partial') {
                        return;
                    }

                    if (!coursesChosen.propertyIsEnumerable(course)) {
                        courseCalendar.removeCourse(course);
                        courseExamInfo.renderCourses(getSelectedCourses());
                    } else {
                        // Remove highlight
                        courseExamInfo.removeHighlighted(course);
                        courseCalendar.unpreviewCourse(course);
                    }

                    previewingFromSelectControl = null;
                }
            }).data('selectize');

            $('.selectize-control .selectize-dropdown').tooltip({selector: '[data-toggle=tooltip]'});

            filterInit();
        } else {
            $('#top-navbar-home').removeClass('d-none');
            $('#top-navbar-share').addClass('d-none');
            $('#top-navbar-semester').addClass('d-none');
            $('#select-course').hide();
        }

        courseButtonList = new CourseButtonList($('#course-button-list'), {
            courseManager: courseManager,
            colorGenerator: function (course) {
                return colorHash.hex(course);
            },
            readonly: viewingSharedSchedule,
            onHoverIn: function (course) {
                courseExamInfo.setHovered(course);
                if (previewingFromSelectControl) {
                    courseCalendar.unpreviewCourse(previewingFromSelectControl);
                }
                courseCalendar.previewCourse(course);
            },
            onHoverOut: function (course) {
                courseExamInfo.removeHovered(course);
                courseCalendar.unpreviewCourse(course);
                if (previewingFromSelectControl) {
                    courseCalendar.previewCourse(previewingFromSelectControl);
                }
            },
            onEnableCourse: function (course) {
                courseCalendar.addCourse(course);
                courseCalendar.previewCourse(course);
                selectedCourseSave(course);
                coursesChosen[course] = true;
                updateGeneralInfoLine();
                courseExamInfo.renderCourses(getSelectedCourses());
                filterApply();
            },
            onDisableCourse: function (course) {
                courseCalendar.removeCourse(course);
                selectedCourseUnsave(course);
                coursesChosen[course] = false;
                updateGeneralInfoLine();
                courseExamInfo.renderCourses(getSelectedCourses());
                filterApply();
            }
        });

        courseExamInfo = new CourseExamInfo($('#course-exam-info'), {
            courseManager: courseManager,
            colorGenerator: function (course) {
                return colorHash.hex(course);
            },
            onHoverIn: function (course) {
                courseButtonList.setHovered(course);
                if (previewingFromSelectControl) {
                    courseCalendar.unpreviewCourse(previewingFromSelectControl);
                }
                courseCalendar.previewCourse(course);
            },
            onHoverOut: function (course) {
                courseButtonList.removeHovered(course);
                courseCalendar.unpreviewCourse(course);
                if (previewingFromSelectControl) {
                    courseCalendar.previewCourse(previewingFromSelectControl);
                }
            }
        });

        courseCalendar = new CourseCalendar($('#course-calendar'), {
            courseManager: courseManager,
            colorGenerator: function (course) {
                return colorHash.hex(course);
            },
            readonly: viewingSharedSchedule,
            onCourseHoverIn: function (course) {
                courseButtonList.setHovered(course);
                courseExamInfo.setHovered(course);
            },
            onCourseHoverOut: function (course) {
                courseButtonList.removeHovered(course);
                courseExamInfo.removeHovered(course);
            },
            onCourseConflictedStatusChanged: function (course, conflicted) {
                if (conflicted) {
                    courseButtonList.setConflicted(course);
                } else {
                    courseButtonList.removeConflicted(course);
                }
            },
            onLessonSelected: function (course, lessonNumber, lessonType) {
                selectedLessonSave(course, lessonNumber, lessonType);
            },
            onLessonUnselected: function (course, lessonNumber, lessonType) {
                selectedLessonUnsave(course, lessonNumber, lessonType);
            }
        });

        $('#top-navbar-supported-content').removeClass('top-navbar-content-uninitialized');

        $('#footer-semester-name').text(semesterFriendlyName(currentSemester));
        $('#footer-semester').removeClass('d-none');

        $('#right-content-bar').removeClass('invisible');

        firebaseInit();
        firestoreDbInit();

        if (viewingSharedSchedule) {
            watchSharedSchedule(function () {
                $('#page-loader').hide();
            });
        } else {
            var firebaseAuthUIInitialized = false;

            try {
                firebaseAuthUIInit(function () {
                    watchSavedSchedule(function () {
                        $('#page-loader').hide();
                    });
                });
                firebaseAuthUIInitialized = true;
            } catch (e) {
                // Firebase UI doesn't work on Edge/IE in private mode.
                // Will fall back to offline mode.
            }

            if (!firebaseAuthUIInitialized) {
                watchSavedSchedule(function () {
                    $('#page-loader').hide();
                });
            }
        }
    }

    function navbarInit() {
        if (!viewingSharedSchedule) {
            var semesterSelect = $('#top-navbar-semester').find('.dropdown-menu');

            Object.keys(availableSemesters).sort().forEach(function (semester) {
                var link = $('<a class="dropdown-item">')
                    .prop('href', '?semester=' + encodeURIComponent(semester))
                    .text(semesterFriendlyName(semester));
                if (semester === currentSemester) {
                    link.addClass('active');
                }
                semesterSelect.append(link);
            });

            $('#top-navbar-login').click(function (event) {
                event.preventDefault();

                if (typeof ga === 'function') {
                    ga('send', 'event', 'navbar', 'login');
                }

                if (loginDialog) {
                    loginDialog.open();
                    return;
                }

                loginDialog = BootstrapDialog.show({
                    title: 'כניסה למערכת',
                    message: $('#firebaseui-auth-container'),
                    buttons: [{
                        label: 'סגור',
                        action: function (dialog) {
                            dialog.close();
                        }
                    }],
                    autodestroy: false
                });
            });

            $('#top-navbar-logout').click(function (event) {
                event.preventDefault();

                if (typeof ga === 'function') {
                    ga('send', 'event', 'navbar', 'logout');
                }

                firebase.auth().signOut();
            });

            $('#top-navbar-share').click(function (event) {
                event.preventDefault();
                if ($(this).find('a').hasClass('disabled')) {
                    return;
                }

                if (typeof ga === 'function') {
                    ga('send', 'event', 'navbar', 'share');
                }

                var url = location.protocol + '//' + location.host + location.pathname +
                    '?semester=' + encodeURIComponent(currentSemester) +
                    '&uid=' + encodeURIComponent(firebase.auth().currentUser.uid);
                var urlElement = $('<a target="_blank">לחצו כאן לפתיחה</a>').prop('href', url);
                var shareDialogContent = $('<div>הקישור לשיתוף המערכת: </div>').append(urlElement);

                BootstrapDialog.show({
                    title: 'שיתוף מערכת',
                    message: shareDialogContent,
                    buttons: [{
                        label: 'העתק קישור',
                        cssClass: 'btn-primary',
                        action: function (dialog) {
                            copyToClipboard(url, function () {
                                dialog.close();
                            }, function () {
                                alert('ההעתקה נכשלה');
                            });
                        }
                    }, {
                        label: 'סגור',
                        action: function (dialog) {
                            dialog.close();
                        }
                    }]
                });
            });

            $('#top-navbar-undo').click(function (event) {
                event.preventDefault();

                if (typeof ga === 'function') {
                    ga('send', 'event', 'navbar', 'undo');
                }

                makeUndo();
            });

            $('#top-navbar-redo').click(function (event) {
                event.preventDefault();

                if (typeof ga === 'function') {
                    ga('send', 'event', 'navbar', 'redo');
                }

                makeRedo();
            });
        }

        $('#top-navbar-export').click(function (event) {
            event.preventDefault();

            if (typeof ga === 'function') {
                ga('send', 'event', 'navbar', 'export');
            }

            var icsCal = ics();

            // Schedule.
            var dateFrom = availableSemesters[currentSemester].start;
            var dateTo = availableSemesters[currentSemester].end;
            courseCalendar.saveAsIcs(icsCal, dateFrom, dateTo);

            // Exams.
            getSelectedCourses().forEach(function (course) {
                var general = courseManager.getGeneralInfo(course);
                ['מועד א', 'מועד ב'].forEach(function (moed) {
                    if (general[moed]) {
                        var parsedDate = courseManager.parseExamDateTime(general[moed]);
                        if (parsedDate) {
                            var title = moed + '\' - ' + general['שם מקצוע'];
                            icsCal.addEvent(title, '', '', parsedDate.start, parsedDate.end);
                        }
                    }
                });
            });

            if (!icsCal.download(semesterFriendlyName(currentSemester))) {
                BootstrapDialog.show({
                    title: 'אופס',
                    message: 'המערכת ריקה',
                    size: BootstrapDialog.SIZE_SMALL
                });
            }
        });
    }

    function firebaseInit() {
        var config = {
            apiKey: 'AIzaSyAfKPyTM83mkLgdQTdx9YS9UXywiswwIYI',
            authDomain: 'cheesefork-de9af.firebaseapp.com',
            databaseURL: 'https://cheesefork-de9af.firebaseio.com',
            projectId: 'cheesefork-de9af',
            storageBucket: 'cheesefork-de9af.appspot.com',
            messagingSenderId: '916559682433'
        };
        firebase.initializeApp(config);
    }

    function firestoreDbInit() {
        firestoreDb = firebase.firestore();
        firestoreDb.settings({timestampsInSnapshots: true}); // silence a warning
    }

    function firebaseAuthUIInit(onInitialized) {
        // FirebaseUI config.
        var uiConfig = {
            // Opens IDP Providers sign-in flow in a popup.
            signInFlow: 'popup',
            signInOptions: [
                // Leave the lines as is for the providers you want to offer your users.
                firebase.auth.GoogleAuthProvider.PROVIDER_ID,
                firebase.auth.EmailAuthProvider.PROVIDER_ID
            ],
            callbacks: {
                // Called when the user has been successfully signed in.
                signInSuccessWithAuthResult: function (authResult) {
                    if (authResult.user) {
                        loginDialog.close();
                    }
                    // Do not redirect.
                    return false;
                }
            },
            // Terms of service url.
            //tosUrl: 'https://policies.google.com/terms',
            // Privacy policy url.
            //privacyPolicyUrl: 'https://policies.google.com/privacy',
            // Disable accountchooser.com which is enabled by default.
            credentialHelper: firebaseui.auth.CredentialHelper.NONE
        };

        // Initialize the FirebaseUI Widget using Firebase.
        var firebaseUI = new firebaseui.auth.AuthUI(firebase.auth());

        var authInitialized = false;

        // Listen to change in auth state so it displays the correct UI for when
        // the user is signed in or not.
        firebase.auth().onAuthStateChanged(function (user) {
            user ? handleSignedInUser(user) : handleSignedOutUser();
            if (!authInitialized) {
                onInitialized();
                authInitialized = true;
            } else if (user) {
                // Slow reload.
                $('#page-loader').show();
                stopScheduleWatching();
                resetSchedule();
                watchSavedSchedule(function () {
                    $('#page-loader').hide();
                });
            } else {
                // Fast reload.
                stopScheduleWatching();
                resetSchedule();
                watchSavedSchedule(function () {});
            }
        });

        function handleSignedInUser(user) {
            $('#top-navbar-login').addClass('d-none');
            $('#top-navbar-logout').removeClass('d-none')
                .find('a').attr('data-original-title', 'מחובר בתור: ' + user.displayName);
            $('#top-navbar-share').find('a').removeClass('disabled').tooltip('disable');
        }

        function handleSignedOutUser() {
            $('#top-navbar-logout').addClass('d-none');
            $('#top-navbar-login').removeClass('d-none');
            $('#top-navbar-share').find('a').addClass('disabled').tooltip('enable');
            firebaseUI.start('#firebaseui-auth-container', uiConfig);
        }
    }

    function filterInit() {
        var faculties = {};
        var points = {};
        var moedAMin = null;
        var moedAMax = null;
        var moedBMin = null;
        var moedBMax = null;

        courseManager.getAllCourses().forEach(function (course) {
            var general = courseManager.getGeneralInfo(course);

            if (general['פקולטה']) {
                faculties[general['פקולטה']] = true;
            }

            if (general['נקודות']) {
                points[general['נקודות']] = true;
            }

            if (general['מועד א']) {
                var dateTimeA = courseManager.parseExamDateTime(general['מועד א']);
                if (dateTimeA) {
                    var moedA = moment.utc(dateTimeA.start).set({hour: 0, minute: 0, second: 0});
                    if (moedAMin === null || moedA.isBefore(moedAMin)) {
                        moedAMin = moedA;
                    }
                    if (moedAMax === null || moedA.isAfter(moedAMax)) {
                        moedAMax = moedA;
                    }
                }
            }

            if (general['מועד ב']) {
                var dateTimeB = courseManager.parseExamDateTime(general['מועד ב']);
                if (dateTimeB) {
                    var moedB = moment.utc(dateTimeB.start).set({hour: 0, minute: 0, second: 0});
                    if (moedBMin === null || moedB.isBefore(moedBMin)) {
                        moedBMin = moedB;
                    }
                    if (moedBMax === null || moedB.isAfter(moedBMax)) {
                        moedBMax = moedB;
                    }
                }
            }
        });

        faculties = Object.keys(faculties).sort();

        var selectFaculties = $('#filter-faculty');

        faculties.forEach(function (faculty) {
            selectFaculties.append($('<option>', {
                value: faculty,
                text: faculty
            }));
        });

        selectFaculties.selectize();

        var selectPointsMin = $('#filter-points-min');
        var selectPointsMax = $('#filter-points-max');

        points = Object.keys(points).sort(function (a, b) {
            return parseFloat(a) - parseFloat(b);
        });

        points.forEach(function (point, i) {
            selectPointsMin.append($('<option>', {
                value: point,
                text: point,
                selected: i === 0
            }));
            selectPointsMax.append($('<option>', {
                value: point,
                text: point,
                selected: i === points.length - 1
            }));
        });

        var selectMoedAMin = $('#filter-moed-a-min');
        var selectMoedAMax = $('#filter-moed-a-max');

        var date, dateStrFull, dateStrShort;

        for (date = moedAMin.clone(); !date.isAfter(moedAMax); date.add(1, 'days')) {
            dateStrFull = date.format();
            dateStrShort = date.format('DD/MM');
            selectMoedAMin.append($('<option>', {
                value: dateStrFull,
                text: dateStrShort,
                selected: date.isSame(moedAMin)
            }));
            selectMoedAMax.append($('<option>', {
                value: dateStrFull,
                text: dateStrShort,
                selected: date.isSame(moedAMax)
            }));
        }

        selectMoedAMax.val(dateStrFull);

        var selectMoedBMin = $('#filter-moed-b-min');
        var selectMoedBMax = $('#filter-moed-b-max');

        for (date = moedBMin.clone(); !date.isAfter(moedBMax); date.add(1, 'days')) {
            dateStrFull = date.format();
            dateStrShort = date.format('DD/MM');
            selectMoedBMin.append($('<option>', {
                value: dateStrFull,
                text: dateStrShort,
                selected: date.isSame(moedBMin)
            }));
            selectMoedBMax.append($('<option>', {
                value: dateStrFull,
                text: dateStrShort,
                selected: date.isSame(moedBMax)
            }));
        }

        selectMoedBMax.val(dateStrFull);
    }

    function filterOpen() {
        if (typeof ga === 'function') {
            ga('send', 'event', 'course-select-filter', 'open');
        }

        if (filterDialog) {
            filterDialog.open();
            return;
        }

        var filterForm = $('#filter-form');
        filterDialog = BootstrapDialog.show({
            cssClass: 'course-filter-dialog',
            title: 'סינון קורסים',
            message: filterForm,
            buttons: [{
                label: 'סינון',
                cssClass: 'btn-primary',
                action: function (dialog) {
                    if (typeof ga === 'function') {
                        ga('send', 'event', 'course-select-filter', 'submit');
                    }

                    filterApply();
                }
            }, {
                label: 'איפוס',
                action: function (dialog) {
                    if (typeof ga === 'function') {
                        ga('send', 'event', 'course-select-filter', 'reset');
                    }

                    filterReset();
                }
            }, {
                label: 'סגור',
                action: function (dialog) {
                    dialog.close();
                }
            }],
            autodestroy: false
        });

        var footer = filterDialog.getModalFooter();
        footer.css('flex-wrap', 'wrap');
        $('<span id="filter-result">').addClass('bootstrap-dialog-message')
            .css({'margin-bottom': '.25rem'}).prependTo(footer);

        filterForm.submit(function (event) {
            event.preventDefault();
            filterDialog.getModalFooter().find('button.btn-primary').click();
        });
    }

    function filterApply() {
        var filters = {};

        var faculties = $('#filter-faculty').data('selectize').items;
        if (faculties.length > 0) {
            filters.faculties = faculties;
        }

        var selectPointsMin = $('#filter-points-min');
        // If not first which is already the minimum.
        if (selectPointsMin.prop('selectedIndex') > 0) {
            filters.pointsMin = parseFloat(selectPointsMin.val());
        }

        var selectPointsMax = $('#filter-points-max');
        // If not last which is already the maximum.
        if (selectPointsMax.prop('selectedIndex') < selectPointsMax.find('option').length - 1) {
            filters.pointsMax = parseFloat(selectPointsMax.val());
        }

        var coursesTaken = $('#filter-courses-taken-list').val().match(/\d+/g);
        if (coursesTaken) {
            filters.coursesTaken = coursesTaken.filter(function (num) {
                return parseInt(num, 10) <= 999999;
            }).map(function (num) {
                return ('000000' + num).slice(-6);
            });
        }

        filters.filterPrerequisites = $('#filter-prerequisites').prop('checked');
        filters.filterLinkedCourses = $('#filter-linked-courses').prop('checked');
        filters.filterOverlappingCourses = $('#filter-overlapping-courses').prop('checked');

        var selectMoedAMin = $('#filter-moed-a-min');
        if (selectMoedAMin.prop('selectedIndex') > 0) {
            filters.moedAMin = selectMoedAMin.val();
        }

        var selectMoedAMax = $('#filter-moed-a-max');
        if (selectMoedAMax.prop('selectedIndex') < selectMoedAMax.find('option').length - 1) {
            filters.moedAMax = selectMoedAMax.val();
        }

        var selectMoedBMin = $('#filter-moed-b-min');
        if (selectMoedBMin.prop('selectedIndex') > 0) {
            filters.moedBMin = selectMoedBMin.val();
        }

        var selectMoedBMax = $('#filter-moed-b-max');
        if (selectMoedBMax.prop('selectedIndex') < selectMoedBMax.find('option').length - 1) {
            filters.moedBMax = selectMoedBMax.val();
        }

        filters.moedADaysMin = parseInt($('#filter-moed-a-days-min').val(), 10);
        filters.moedBDaysMin = parseInt($('#filter-moed-b-days-min').val(), 10);

        filters.filterWithExam = $('#filter-with-exam').prop('checked');
        filters.filterWithoutExam = $('#filter-without-exam').prop('checked');

        var coursesLimit = $('#filter-courses-limit').val().match(/\d+/g);
        if (coursesLimit) {
            filters.coursesLimit = coursesLimit.filter(function (num) {
                return parseInt(num, 10) <= 999999;
            }).map(function (num) {
                return ('000000' + num).slice(-6);
            });
        }

        var coursesExclude = $('#filter-courses-exclude').val().match(/\d+/g);
        if (coursesExclude) {
            filters.coursesExclude = coursesExclude.filter(function (num) {
                return parseInt(num, 10) <= 999999;
            }).map(function (num) {
                return ('000000' + num).slice(-6);
            });
        }

        var selectedCourses = getSelectedCourses();
        if (selectedCourses.length > 0) {
            filters.coursesCurrent = selectedCourses;
        }

        var filtered = courseManager.filterCourses(filters);
        filteredCoursesCount = filtered.length;

        courseSelect.clearOptions();
        courseSelect.addOption(makeCourseSelectOptions(filtered.sort()));

        if (filterDialog) {
            var messageElement = filterDialog.getModalFooter().find('#filter-result');
            messageElement.text('מציג ' + filteredCoursesCount + ' מתוך ' + allCoursesCount + ' קורסים');
        }
    }

    function filterReset() {
        $('#filter-form').trigger('reset');
        $('#filter-faculty').data('selectize').clear(); // selectize doesn't work with reset

        if (filteredCoursesCount < allCoursesCount) {
            courseSelect.clearOptions();
            courseSelect.addOption(makeCourseSelectOptions(courseManager.getAllCourses().sort()));
            filteredCoursesCount = allCoursesCount;
        }

        if (filterDialog) {
            var messageElement = filterDialog.getModalFooter().find('#filter-result');
            messageElement.text('');
        }
    }

    function makeCourseSelectOptions(courses) {
        var items = [{
            value: 'filter',
            text: ''
        }].concat(courses.map(function (course) {
            var general = courseManager.getGeneralInfo(course);
            return {
                value: course,
                text: course + ' - ' + general['שם מקצוע']
            };
        }));

        if (items.length > 202) {
            items.splice(201, 0, {
                value: 'partial',
                text: ''
            });
        }

        return items;
    }

    function semesterFriendlyName(semester) {
        var year = parseInt(semester.slice(0, 4), 10);
        var semesterCode = semester.slice(4);

        switch (semesterCode) {
            case '01':
                return 'חורף ' + year + '-' + (year + 1);

            case '02':
                return 'אביב ' + (year + 1);

            case '03':
                return 'קיץ ' + (year + 1);

            default:
                return semester;
        }
    }

    function getSelectedCourses() {
        return Object.keys(coursesChosen).filter(function (course) {
            return coursesChosen[course];
        });
    }

    function updateGeneralInfoLine() {
        var courses = 0;
        var points = 0;

        getSelectedCourses().forEach(function (course) {
            var general = courseManager.getGeneralInfo(course);
            courses++;
            points += parseFloat(general['נקודות']);
        });

        points = points.toFixed(1).replace(/\.0+$/, '');

        var text;
        if (courses > 0) {
            if (courses === 1) {
                text = 'מקצוע אחד';
            } else {
                text = courses + ' מקצועות';
            }

            text += ', ';
            if (points === '1') {
                text += 'נקודה אחת';
            } else {
                text += points + ' נקודות';
            }
        } else {
            text = 'לא נבחרו מקצועות';
        }

        $('#general-info').text(text);
    }

    function selectedCourseSave(course) {
        var semesterCoursesKey = currentSemester + '_courses';
        var courseKey = currentSemester + '_' + course;

        currentSavedSession[semesterCoursesKey].push(course);
        currentSavedSession[courseKey] = {};

        var doc = firestoreAuthenticatedUserDoc();
        if (doc) {
            var input = {};
            input[semesterCoursesKey] = firebase.firestore.FieldValue.arrayUnion(course);
            input[courseKey] = {};
            doc.set(input, {merge: true});
        } else {
            try {
                localStorage.setItem(semesterCoursesKey, JSON.stringify(currentSavedSession[semesterCoursesKey]));
                localStorage.removeItem(courseKey);
            } catch (e) {
                // localStorage is not available in IE/Edge when running from a local file.
            }
        }

        onSavedSessionChange();
    }

    function selectedCourseUnsave(course) {
        var semesterCoursesKey = currentSemester + '_courses';
        var courseKey = currentSemester + '_' + course;

        currentSavedSession[semesterCoursesKey] = currentSavedSession[semesterCoursesKey].filter(function (item) {
            return item !== course;
        });
        delete currentSavedSession[courseKey];

        var doc = firestoreAuthenticatedUserDoc();
        if (doc) {
            var input = {};
            input[semesterCoursesKey] = firebase.firestore.FieldValue.arrayRemove(course);
            input[courseKey] = firebase.firestore.FieldValue.delete();
            doc.update(input);
        } else {
            try {
                localStorage.setItem(semesterCoursesKey, JSON.stringify(currentSavedSession[semesterCoursesKey]));
                localStorage.removeItem(courseKey);
            } catch (e) {
                // localStorage is not available in IE/Edge when running from a local file.
            }
        }

        onSavedSessionChange();
    }

    function selectedLessonSave(course, lessonNumber, lessonType) {
        var courseKey = currentSemester + '_' + course;

        currentSavedSession[courseKey][lessonType] = lessonNumber;

        var doc = firestoreAuthenticatedUserDoc();
        if (doc) {
            var input = {};
            input[courseKey + '.' + lessonType] = lessonNumber;
            doc.update(input);
        } else {
            try {
                localStorage.setItem(courseKey, JSON.stringify(currentSavedSession[courseKey]));
            } catch (e) {
                // localStorage is not available in IE/Edge when running from a local file.
            }
        }

        onSavedSessionChange();
    }

    function selectedLessonUnsave(course, lessonNumber, lessonType) {
        var courseKey = currentSemester + '_' + course;

        delete currentSavedSession[courseKey][lessonType];

        var doc = firestoreAuthenticatedUserDoc();
        if (doc) {
            var input = {};
            input[courseKey + '.' + lessonType] = firebase.firestore.FieldValue.delete();
            doc.update(input);
        } else {
            try {
                localStorage.setItem(courseKey, JSON.stringify(currentSavedSession[courseKey]));
            } catch (e) {
                // localStorage is not available in IE/Edge when running from a local file.
            }
        }

        onSavedSessionChange();
    }

    function watchSharedSchedule(onLoadedFunc) {
        var firstDataLoaded = false;

        var doc = firestoreUserDoc(scheduleSharingUserId);
        doc.onSnapshot(function (result) {
            var session = result.exists ? savedSessionFromFirestoreData(result.data()) : {};
            setScheduleFromSavedSession(session, !firstDataLoaded);

            if (result.exists && result.data().displayName) {
                $('#sharing-user-name').text(result.data().displayName);
                $('#sharing-user-known').removeClass('d-none');
                $('#sharing-user-unknown').addClass('d-none');
            } else {
                $('#sharing-user-unknown').removeClass('d-none');
                $('#sharing-user-known').addClass('d-none');
            }

            if (!firstDataLoaded) {
                onLoadedFunc();
                firstDataLoaded = true;
            }
        }, function (error) {
            alert('Error loading data from server: ' + error);
        });
    }

    function watchSavedSchedule(onLoadedFunc) {
        var doc = firestoreAuthenticatedUserDoc();
        if (doc) {
            var firstDataLoaded = false;

            stopScheduleWatching = doc.onSnapshot(function (result) {
                if (result.metadata.hasPendingWrites) {
                    // The callback was called as a result of a local change, ignore it.
                    // https://stackoverflow.com/questions/50186413/is-firestore-onsnapshot-update-event-due-to-local-client-set
                    return;
                }

                if (!firstDataLoaded) {
                    // Save name in server for sharing purposes.
                    doc.set({displayName: firebase.auth().currentUser.displayName}, {merge: true});
                }

                var session = savedSessionFromFirestoreData(result.exists ? result.data() : {});
                setScheduleFromSavedSession(session, !firstDataLoaded);

                currentSavedSession = session;

                if (!firstDataLoaded) {
                    onSavedSessionReset();
                    onLoadedFunc();
                    firstDataLoaded = true;
                } else {
                    onSavedSessionChange();
                }
            }, function (error) {
                alert('Error loading data from server: ' + error);
            });
        } else {
            var onStorageEvent = function (e) {
                var prefix = currentSemester + '_';
                // Check if the line starts with a required prefix.
                // https://stackoverflow.com/a/4579228
                if (e.key.lastIndexOf(prefix, 0) === 0) {
                    var session = savedSessionFromLocalStorage();
                    setScheduleFromSavedSession(session, true);

                    currentSavedSession = session;
                    onSavedSessionChange();
                }
            };

            window.addEventListener('storage', onStorageEvent);

            stopScheduleWatching = function () {
                window.removeEventListener('storage', onStorageEvent);
            };

            var session = savedSessionFromLocalStorage();
            setScheduleFromSavedSession(session, false);

            currentSavedSession = session;
            onSavedSessionReset();

            onLoadedFunc();
        }
    }

    function savedSessionFromLocalStorage() {
        var semesterCoursesKey = currentSemester + '_courses';
        var session = {};
        try {
            session[semesterCoursesKey] = JSON.parse(localStorage.getItem(semesterCoursesKey) || '[]');
            session[semesterCoursesKey].forEach(function (course) {
                var courseKey = currentSemester + '_' + course;
                session[courseKey] = JSON.parse(localStorage.getItem(courseKey) || '{}');
            });
        } catch (e) {
            // localStorage is not available in IE/Edge when running from a local file.
            session[semesterCoursesKey] = [];
        }
        return session;
    }

    function savedSessionFromFirestoreData(data) {
        // Returns only the data relevant to the current semester from data.
        var semesterCoursesKey = currentSemester + '_courses';
        var session = {};
        session[semesterCoursesKey] = data[semesterCoursesKey] || [];
        session[semesterCoursesKey].forEach(function (course) {
            var courseKey = currentSemester + '_' + course;
            session[courseKey] = data[courseKey] || {};
        });
        return session;
    }

    function restoreSavedSession(currentSession, sessionToRestore) {
        var newKeys = [], removeKeys = [];

        var semesterCoursesKey = currentSemester + '_courses';
        var currentCourses = currentSession[semesterCoursesKey];
        var newCourses = sessionToRestore[semesterCoursesKey];
        if (JSON.stringify(currentCourses) !== JSON.stringify(newCourses)) {
            newKeys.push(semesterCoursesKey);
        }

        currentCourses.forEach(function (course) {
            if (newCourses.indexOf(course) === -1) {
                var courseKey = currentSemester + '_' + course;
                removeKeys.push(courseKey);
            }
        });

        newCourses.forEach(function (course) {
            var courseKey = currentSemester + '_' + course;
            if (currentCourses.indexOf(course) === -1) {
                newKeys.push(courseKey);
            } else {
                var currentLessons = currentSession[courseKey];
                var newLessons = sessionToRestore[courseKey];
                // Can be different even if object are equal due to key order,
                // but that's OK, we'll just override the same data.
                if (JSON.stringify(currentLessons) !== JSON.stringify(newLessons)) {
                    newKeys.push(courseKey);
                }
            }
        });

        var doc = firestoreAuthenticatedUserDoc();
        if (doc) {
            var input = {};

            removeKeys.forEach(function (key) {
                input[key] = firebase.firestore.FieldValue.delete();
            });

            newKeys.forEach(function (key) {
                input[key] = sessionToRestore[key];
            });

            doc.update(input);
        } else {
            try {
                removeKeys.forEach(function (key) {
                    localStorage.removeItem(key);
                });

                newKeys.forEach(function (key) {
                    localStorage.setItem(key, JSON.stringify(sessionToRestore[key]));
                });
            } catch (e) {
                // localStorage is not available in IE/Edge when running from a local file.
            }
        }

        setScheduleFromSavedSession(sessionToRestore);
    }

    function setScheduleFromSavedSession(session, restoreScrollPosition) {
        var scrollTop;
        if (restoreScrollPosition) {
            scrollTop = $(window).scrollTop(); // save scroll position
        }

        var semesterCoursesKey = currentSemester + '_courses';

        coursesChosen = {};
        courseButtonList.clear();

        var schedule = {};

        var courses = session[semesterCoursesKey] || [];
        courses.forEach(function (course) {
            if (!coursesChosen.propertyIsEnumerable(course) && courseManager.doesExist(course)) {
                coursesChosen[course] = true;
                courseButtonList.addCourse(course);

                var courseKey = currentSemester + '_' + course;
                var lessons = session[courseKey] || {};
                schedule[course] = lessons;
            }
        });

        courseCalendar.loadSavedSchedule(schedule);
        updateGeneralInfoLine();
        courseExamInfo.renderCourses(getSelectedCourses());

        if (restoreScrollPosition) {
            $(window).scrollTop(scrollTop); // restore scroll position
        }
    }

    function resetSchedule() {
        coursesChosen = {};
        courseButtonList.clear();
        courseCalendar.removeAll();
        updateGeneralInfoLine();
        courseExamInfo.renderCourses(getSelectedCourses());
        filterReset();
    }

    function onSavedSessionReset() {
        savedSessionForUndo = $.extend(true, {}, currentSavedSession); // make a deep copy

        $('#top-navbar-undo').addClass('d-none');
        $('#top-navbar-redo').addClass('d-none');
    }

    function onSavedSessionChange() {
        $('#top-navbar-undo').removeClass('d-none');
        $('#top-navbar-redo').addClass('d-none');
    }

    function makeUndo() {
        restoreSavedSession(currentSavedSession, savedSessionForUndo);

        savedSessionForRedo = currentSavedSession;
        currentSavedSession = $.extend(true, {}, savedSessionForUndo); // make a deep copy

        $('#top-navbar-undo').addClass('d-none');
        $('#top-navbar-redo').removeClass('d-none');
    }

    function makeRedo() {
        restoreSavedSession(currentSavedSession, savedSessionForRedo);

        currentSavedSession = savedSessionForRedo;
        savedSessionForRedo = null;

        $('#top-navbar-redo').addClass('d-none');
        $('#top-navbar-undo').removeClass('d-none');
    }

    function firestoreAuthenticatedUserDoc() {
        if (typeof firebase !== 'undefined' && firebase.auth().currentUser !== null) {
            return firestoreDb.collection('users').doc(firebase.auth().currentUser.uid);
        }
        return null;
    }

    function firestoreUserDoc(userId) {
        return firestoreDb.collection('users').doc(userId);
    }

    // https://stackoverflow.com/a/30810322
    function copyToClipboard(text, onSuccess, onFailure) {
        if (!navigator.clipboard) {
            fallbackCopyTextToClipboard(text);
            return;
        }
        navigator.clipboard.writeText(text).then(function() {
            onSuccess();
        }, function (err) {
            onFailure();
        });

        function fallbackCopyTextToClipboard(text) {
            var textArea = document.createElement("textarea");
            textArea.value = text;
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();

            var successful = false;
            try {
                successful = document.execCommand('copy');
            } catch (err) { }

            document.body.removeChild(textArea);

            if (successful) {
                onSuccess();
            } else {
                onFailure();
            }
        }
    }
})();
