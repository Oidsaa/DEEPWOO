<?php
/**
 * Plugin Name: WC App Change Log
 * Description: جدول لاگ تغییرات مشترک برای داشبورد دسکتاپ ووکامرس — ثبت و خواندن اکشن کارشناس‌ها از طریق REST، با احراز هویت کلیدهای API ووکامرس (OAuth 1.0a یا query-string). نام کارشناس از صاحب کلید API خوانده می‌شود.
 * Version: 1.0.0
 * Requires PHP: 7.2
 * Author: DEEPWOO
 */

defined( 'ABSPATH' ) || exit;

class WcAppChangeLog {

	const DB_VERSION   = '1.0';
	const DB_OPT       = 'wcapp_log_db_version';
	const REST_NS      = 'wcapp/v1';
	const MAX_AGE_DAYS = 365;

	/** کاربر احرازشدهٔ فعلی: [user_id, user_name] صاحب کلید API. */
	private static $auth = null;

	public static function init() {
		add_action( 'init', [ __CLASS__, 'maybe_install' ] );
		add_action( 'rest_api_init', [ __CLASS__, 'register_routes' ] );
		add_action( 'wcapp_log_prune', [ __CLASS__, 'prune' ] );

		if ( ! wp_next_scheduled( 'wcapp_log_prune' ) ) {
			wp_schedule_event( time() + HOUR_IN_SECONDS, 'daily', 'wcapp_log_prune' );
		}
	}

	/* ---------------------------------------------------------------------
	 * جدول
	 * ------------------------------------------------------------------- */

	public static function maybe_install() {
		if ( get_option( self::DB_OPT ) === self::DB_VERSION ) {
			return;
		}

		global $wpdb;
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';

		$charset = $wpdb->get_charset_collate();
		dbDelta( "CREATE TABLE {$wpdb->prefix}wc_app_change_log (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			ts bigint(20) NOT NULL DEFAULT 0,
			created datetime NOT NULL,
			user_id bigint(20) unsigned NOT NULL DEFAULT 0,
			user_name varchar(191) NOT NULL DEFAULT '',
			device varchar(191) NOT NULL DEFAULT '',
			section varchar(32) NOT NULL DEFAULT '',
			action varchar(32) NOT NULL DEFAULT '',
			title varchar(255) NOT NULL DEFAULT '',
			details text NULL,
			target varchar(191) NOT NULL DEFAULT '',
			PRIMARY KEY  (id),
			KEY section (section),
			KEY user_name (user_name),
			KEY ts (ts)
		) {$charset};" );

		update_option( self::DB_OPT, self::DB_VERSION );
	}

	private static function table() {
		global $wpdb;
		return $wpdb->prefix . 'wc_app_change_log';
	}

	/** پاک‌سازی روزانهٔ ردیف‌های قدیمی‌تر از wcapp_log_max_age_days روز (پیش‌فرض ۳۶۵). */
	public static function prune() {
		global $wpdb;
		$days = (int) apply_filters( 'wcapp_log_max_age_days', self::MAX_AGE_DAYS );
		if ( $days <= 0 ) {
			return;
		}
		$cutoff = ( time() - $days * DAY_IN_SECONDS ) * 1000;
		$wpdb->query( $wpdb->prepare( 'DELETE FROM ' . self::table() . ' WHERE ts < %d', $cutoff ) );
	}

	/* ---------------------------------------------------------------------
	 * REST
	 * ------------------------------------------------------------------- */

	public static function register_routes() {
		register_rest_route(
			self::REST_NS,
			'/log',
			[
				[
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => [ __CLASS__, 'rest_post_log' ],
					'permission_callback' => [ __CLASS__, 'rest_permission_write' ],
				],
				[
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => [ __CLASS__, 'rest_get_log' ],
					'permission_callback' => [ __CLASS__, 'rest_permission_read' ],
				],
			]
		);

		register_rest_route(
			self::REST_NS,
			'/ping',
			[
				[
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => [ __CLASS__, 'rest_ping' ],
					'permission_callback' => [ __CLASS__, 'rest_permission_read' ],
				],
			]
		);
	}

	public static function rest_permission_read( $request ) {
		$auth = self::authenticate( $request, 'read' );
		return is_wp_error( $auth ) ? $auth : true;
	}

	public static function rest_permission_write( $request ) {
		$auth = self::authenticate( $request, 'write' );
		return is_wp_error( $auth ) ? $auth : true;
	}

	public static function rest_ping() {
		return [
			'ok'    => true,
			'user'  => self::$auth['user_name'] ?? '',
			'table' => self::table(),
		];
	}

	/**
	 * ثبت ردیف(های) لاگ.
	 *
	 * بدنه: یک آبجکت یا آرایهٔ ردیف‌ها یا { entries: [...] } با فیلدهای
	 * section, action, title (الزامی), details?, target?, device?, user?, ts? (میلی‌ثانیه).
	 * اگر user خالی باشد، نام صاحب کلید API استفاده می‌شود.
	 */
	public static function rest_post_log( WP_REST_Request $request ) {
		global $wpdb;

		$body = $request->get_json_params();
		if ( ! is_array( $body ) || ! $body ) {
			$body = json_decode( (string) $request->get_body(), true );
		}
		if ( ! is_array( $body ) || ! $body ) {
			return new WP_Error( 'wcapp_bad_body', 'بدنهٔ درخواست JSON معتبر نیست.', [ 'status' => 400 ] );
		}

		if ( isset( $body[0] ) ) {
			$items = $body;
		} elseif ( isset( $body['entries'] ) && is_array( $body['entries'] ) ) {
			$items = $body['entries'];
		} else {
			$items = [ $body ];
		}

		$sections = [ 'orders', 'products', 'customers', 'warehouses', 'settings', 'system' ];
		$now_ms   = (int) round( microtime( true ) * 1000 );
		$table    = self::table();
		$ids      = [];

		foreach ( $items as $item ) {
			if ( ! is_array( $item ) ) {
				continue;
			}

			$title = self::clean( $item['title'] ?? '', 255 );
			if ( '' === $title ) {
				return new WP_Error( 'wcapp_bad_entry', 'هر ردیف لاگ باید «title» داشته باشد.', [ 'status' => 400 ] );
			}

			$section = in_array( $item['section'] ?? '', $sections, true ) ? (string) $item['section'] : 'system';

			$ts = isset( $item['ts'] ) ? (int) $item['ts'] : $now_ms;
			if ( $ts <= 0 || $ts > $now_ms + 6 * HOUR_IN_SECONDS * 1000 ) {
				$ts = $now_ms;
			}

			$user_name = self::clean( $item['user'] ?? '', 191 );
			if ( '' === $user_name ) {
				$user_name = self::$auth['user_name'] ?? '';
			}

			$wpdb->insert(
				$table,
				[
					'ts'        => $ts,
					'created'   => gmdate( 'Y-m-d H:i:s', (int) floor( $ts / 1000 ) ),
					'user_id'   => (int) ( self::$auth['user_id'] ?? 0 ),
					'user_name' => $user_name,
					'device'    => self::clean( $item['device'] ?? '', 191 ),
					'section'   => $section,
					'action'    => self::clean( $item['action'] ?? '', 32 ),
					'title'     => $title,
					'details'   => self::clean( $item['details'] ?? '', 5000 ),
					'target'    => self::clean( $item['target'] ?? '', 191 ),
				],
				[ '%d', '%s', '%d', '%s', '%s', '%s', '%s', '%s', '%s', '%s' ]
			);

			if ( $wpdb->insert_id ) {
				$ids[] = (int) $wpdb->insert_id;
			}
		}

		return [ 'ok' => true, 'inserted' => count( $ids ), 'ids' => $ids ];
	}

	/**
	 * خواندن لاگ.
	 *
	 * پارامترها: page, per_page (≤200), user, section, search, after (ts میلی‌ثانیه).
	 * خروجی هم‌شکل ChangeLogResult برنامهٔ دسکتاپ است.
	 */
	public static function rest_get_log( WP_REST_Request $request ) {
		global $wpdb;
		$table    = self::table();
		$page     = max( 1, (int) $request->get_param( 'page' ) ?: 1 );
		$per_page = min( 200, max( 1, (int) $request->get_param( 'per_page' ) ?: 50 ) );

		$where = [];
		$args  = [];

		$user = trim( (string) $request->get_param( 'user' ) );
		if ( '' !== $user ) {
			$where[] = 'user_name = %s';
			$args[]  = $user;
		}

		$section = trim( (string) $request->get_param( 'section' ) );
		if ( '' !== $section ) {
			$where[] = 'section = %s';
			$args[]  = $section;
		}

		$after = (int) $request->get_param( 'after' );
		if ( $after > 0 ) {
			$where[] = 'ts > %d';
			$args[]  = $after;
		}

		$search = trim( (string) $request->get_param( 'search' ) );
		if ( '' !== $search ) {
			$like    = '%' . $wpdb->esc_like( $search ) . '%';
			$where[] = '( title LIKE %s OR details LIKE %s OR target LIKE %s OR user_name LIKE %s )';
			array_push( $args, $like, $like, $like, $like );
		}

		$where_sql = $where ? 'WHERE ' . implode( ' AND ', $where ) : '';

		if ( $args ) {
			$total = (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM {$table} {$where_sql}", $args ) );
		} else {
			$total = (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$table}" );
		}

		$q_args   = $args;
		$q_args[] = $per_page;
		$q_args[] = ( $page - 1 ) * $per_page;

		if ( $where ) {
			$rows = $wpdb->get_results(
				$wpdb->prepare( "SELECT * FROM {$table} {$where_sql} ORDER BY ts DESC, id DESC LIMIT %d OFFSET %d", $q_args ),
				ARRAY_A
			);
		} else {
			$rows = $wpdb->get_results(
				$wpdb->prepare( "SELECT * FROM {$table} ORDER BY ts DESC, id DESC LIMIT %d OFFSET %d", $per_page, ( $page - 1 ) * $per_page ),
				ARRAY_A
			);
		}

		$users = $wpdb->get_col( "SELECT DISTINCT user_name FROM {$table} WHERE user_name <> '' ORDER BY user_name" );

		$entries = array_map(
			static function ( $r ) {
				return [
					'ts'      => (int) $r['ts'],
					'user'    => (string) $r['user_name'],
					'section' => (string) $r['section'],
					'action'  => (string) $r['action'],
					'title'   => (string) $r['title'],
					'details' => (string) ( $r['details'] ?? '' ),
					'target'  => (string) $r['target'],
					'device'  => (string) $r['device'],
				];
			},
			(array) $rows
		);

		return [
			'entries' => $entries,
			'total'   => $total,
			'page'    => $page,
			'perPage' => $per_page,
			'users'   => array_values( (array) $users ),
		];
	}

	/* ---------------------------------------------------------------------
	 * احراز هویت با کلیدهای ووکامرس
	 * ------------------------------------------------------------------- */

	/**
	 * دو روش پشتیبانی می‌شود:
	 *  1) OAuth 1.0a (همان روش اصلی برنامهٔ دسکتاپ) — هدر Authorization یا پارامترهای oauth_* کوئری.
	 *  2) ساده: ?consumer_key=ck_...&consumer_secret=cs_... (مثل auth کوئری‌استرینگ خود ووکامرس؛ فقط روی HTTPS).
	 */
	private static function authenticate( WP_REST_Request $request, $needed ) {
		$oauth = self::oauth_params();

		if ( empty( $oauth['oauth_consumer_key'] ) ) {
			$ck = (string) ( $_GET['consumer_key'] ?? '' );
			$cs = (string) ( $_GET['consumer_secret'] ?? '' );
			if ( '' === $ck || '' === $cs ) {
				return new WP_Error( 'wcapp_no_auth', 'کلید API ارائه نشده است.', [ 'status' => 401 ] );
			}
			$row = self::find_key( $ck );
			if ( ! $row || ! hash_equals( (string) $row['consumer_secret'], $cs ) ) {
				return new WP_Error( 'wcapp_bad_auth', 'کلید API معتبر نیست.', [ 'status' => 401 ] );
			}
			return self::authorize( $row, $needed );
		}

		if ( 'HMAC-SHA1' !== strtoupper( (string) ( $oauth['oauth_signature_method'] ?? '' ) ) ) {
			return new WP_Error( 'wcapp_bad_method', 'فقط HMAC-SHA1 پشتیبانی می‌شود.', [ 'status' => 401 ] );
		}

		$window = (int) apply_filters( 'wcapp_log_timestamp_window', 900 );
		if ( abs( time() - (int) ( $oauth['oauth_timestamp'] ?? 0 ) ) > $window ) {
			return new WP_Error( 'wcapp_expired', 'امضای OAuth منقضی شده است.', [ 'status' => 401 ] );
		}

		$row = self::find_key( (string) $oauth['oauth_consumer_key'] );
		if ( ! $row ) {
			return new WP_Error( 'wcapp_bad_key', 'کلید API معتبر نیست.', [ 'status' => 401 ] );
		}

		if ( ! self::verify_signature( (string) $row['consumer_secret'], $oauth ) ) {
			return new WP_Error( 'wcapp_bad_signature', 'امضای OAuth معتبر نیست.', [ 'status' => 401 ] );
		}

		return self::authorize( $row, $needed );
	}

	private static function authorize( $row, $needed ) {
		$perm = (string) $row['permissions'];
		$ok   = ( 'read' === $needed )
			? in_array( $perm, [ 'read', 'read_write' ], true )
			: in_array( $perm, [ 'write', 'read_write' ], true );
		if ( ! $ok ) {
			return new WP_Error( 'wcapp_forbidden', 'سطح دسترسی کلید API کافی نیست (نیاز: ' . $needed . ').', [ 'status' => 403 ] );
		}

		$name = '';
		$user = get_userdata( (int) $row['user_id'] );
		if ( $user ) {
			$name = $user->display_name ? $user->display_name : $user->user_login;
			wp_set_current_user( (int) $user->ID );
		}

		self::$auth = [
			'user_id'   => (int) $row['user_id'],
			'user_name' => $name,
		];

		return true;
	}

	/** کلیدها در ووکامرس هش می‌شوند: wc_api_hash = hash_hmac( 'sha256', key, 'wc-api' ). */
	private static function find_key( $consumer_key ) {
		global $wpdb;
		$hash = function_exists( 'wc_api_hash' )
			? wc_api_hash( $consumer_key )
			: hash_hmac( 'sha256', $consumer_key, 'wc-api' );

		return $wpdb->get_row(
			$wpdb->prepare(
				"SELECT user_id, permissions, consumer_secret FROM {$wpdb->prefix}woocommerce_api_keys WHERE consumer_key = %s LIMIT 1",
				$hash
			),
			ARRAY_A
		);
	}

	/** پارامترهای OAuth: از هدر Authorization یا کوئری. */
	private static function oauth_params() {
		$params = [];

		$header = $_SERVER['HTTP_AUTHORIZATION'] ?? ( $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '' );
		if ( $header && 0 === stripos( $header, 'oauth ' ) ) {
			foreach ( preg_split( '/,\s*/', trim( substr( $header, 6 ) ) ) as $piece ) {
				if ( preg_match( '/^([a-zA-Z0-9_]+)="(.*)"$/', trim( (string) $piece ), $m ) ) {
					$params[ strtolower( $m[1] ) ] = rawurldecode( $m[2] );
				}
			}
		}

		foreach ( (array) $_GET as $k => $v ) {
			if ( 0 === strpos( (string) $k, 'oauth_' ) ) {
				$params[ strtolower( (string) $k ) ] = (string) wp_unslash( $v );
			}
		}

		return $params;
	}

	private static function verify_signature( $consumer_secret, array $oauth ) {
		$signature = (string) ( $oauth['oauth_signature'] ?? '' );
		if ( '' === $signature ) {
			return false;
		}
		unset( $oauth['oauth_signature'] );

		$method = strtoupper( $_SERVER['REQUEST_METHOD'] ?? 'GET' );
		$url    = self::current_url();

		// مثل خود ووکامرس: اگر با اسکیم فعلی نخورد، اسکیم دیگر هم امتحان می‌شود.
		foreach ( [ is_ssl() ? 'https' : 'http', is_ssl() ? 'http' : 'https' ] as $scheme ) {
			$try_url = $scheme . '://' . substr( $url, strpos( $url, '://' ) + 3 );
			if ( hash_equals( self::compute_signature( $method, $try_url, $oauth, $consumer_secret ), $signature ) ) {
				return true;
			}
		}
		return false;
	}

	private static function current_url() {
		$scheme = is_ssl() ? 'https' : 'http';
		$host   = (string) ( $_SERVER['HTTP_HOST'] ?? '' );
		$path   = (string) parse_url( (string) ( $_SERVER['REQUEST_URI'] ?? '/' ), PHP_URL_PATH );

		return $scheme . '://' . $host . ( '' !== $path ? $path : '/' );
	}

	private static function compute_signature( $method, $url, array $params, $secret ) {
		$pairs = [];
		foreach ( $params as $k => $v ) {
			$pairs[] = [ rawurlencode( (string) $k ), rawurlencode( (string) $v ) ];
		}
		usort(
			$pairs,
			static function ( $a, $b ) {
				return $a[0] === $b[0] ? strcmp( $a[1], $b[1] ) : strcmp( $a[0], $b[0] );
			}
		);

		$normalized = '';
		foreach ( $pairs as $p ) {
			$normalized .= ( '' === $normalized ? '' : '&' ) . $p[0] . '=' . $p[1];
		}

		$base = strtoupper( $method ) . '&' . rawurlencode( $url ) . '&' . rawurlencode( $normalized );
		$key  = rawurlencode( (string) $secret ) . '&'; // کلیدهای ووکامرس token secret ندارند.

		return base64_encode( hash_hmac( 'sha1', $base, $key, true ) );
	}

	private static function clean( $value, $max ) {
		$v = trim( wp_strip_all_tags( (string) $value ) );
		if ( $max > 0 ) {
			$v = function_exists( 'mb_substr' ) ? mb_substr( $v, 0, $max ) : substr( $v, 0, $max );
		}
		return $v;
	}
}

WcAppChangeLog::init();

register_activation_hook( __FILE__, [ 'WcAppChangeLog', 'maybe_install' ] );
register_deactivation_hook(
	__FILE__,
	static function () {
		wp_clear_scheduled_hook( 'wcapp_log_prune' );
	}
);
